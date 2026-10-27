// `specs-bot mcp` (PLAN.md § 5.7): the CLI as an MCP server over stdio, one per agent session, connected for the
// whole session instead of one process per command. On start it takes the folder's party (SPECS_BOT_AS / --as)
// over the api's websocket (`/api/ws?as=<party>`): the lease lasts as long as the connection, and the hello's
// session id goes with every HTTP call of this process. The same socket brings the events (writes, chat,
// presence — never doing or session, which only the site's /now page asks for); each tool result ends with the ones that arrived since the previous call, and `wait` blocks for the
// next. Every answer is TOON, as the CLI prints it. stdout is the protocol: logs go to stderr.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type CallToolResult, CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { encode } from "@toon-format/toon";
import { ApiError, type Query, request } from "./client.ts";
import type { ClientConfig } from "./config.ts";
import { render } from "./output.ts";
import { sessionLabel } from "./session.ts";
import { printDoing, printWrite, type WriteAnswer, type WriteArgs, writeBody } from "./write.ts";

const log = (s: string) => process.stderr.write(`specs-bot mcp: ${s}\n`);

/** An event of the api's websocket (events.ts in the api): write, chat or presence. */
export type Event = { type: string; party?: string; from?: string; to?: string } & Record<string, unknown>;

export interface WaitFilter {
  types?: string[];
  /** Chat to this party (or to all) only; none means chat to anyone. */
  to?: string;
}

const MAX_BUFFER = 200;

type Opened = { ws: WebSocket; hello: Record<string, unknown> } | { code: number; reason: string };

/** The websocket to the api: the party's lease while it is open, and the events it brings. */
export class Link {
  party: string | undefined;
  /** The lease's session id (the hello's), while this process holds the party. */
  session: string | undefined;
  since: string | undefined;
  /** Why the party could not be taken: another session holds it (4409), or no such party (4422). */
  refused: { code: number; reason: string } | undefined;
  #ws: WebSocket | undefined;
  #events: Event[] = [];
  #dropped = 0;
  #waiters = new Set<(e: Event) => boolean>();
  #backoff = 1000;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #connecting: Promise<void> | undefined;
  #closed = false;

  // The party is the session's, never the folder's: two sessions in one folder (the maintainer and machine-1 on the
  // host) are two parties. A session names its own with the `as` tool; nothing is taken until it does.
  constructor(
    readonly config: ClientConfig,
    readonly label: string,
  ) {}

  /** Takes `party` for this session, letting go of the one it held; resolves once the api has answered. */
  async take(party: string): Promise<void> {
    if (this.party === party && this.session) return;
    this.#drop();
    this.party = party;
    this.refused = undefined;
    await this.connect();
  }

  /** Lets go of this session's party and goes on as a reader. */
  async release(): Promise<void> {
    this.#drop();
    this.party = undefined;
    this.refused = undefined;
    await this.connect();
  }

  /** Closes the socket that holds the party (the api frees it at once). */
  #drop(): void {
    const old = this.#ws;
    this.#ws = undefined;
    this.session = undefined;
    this.since = undefined;
    if (old) {
      old.onclose = null;
      old.close(1000, "letting go");
    }
  }

  get online(): boolean {
    return this.#ws !== undefined;
  }

  /** Connects, taking the party when one is named; once at a time. */
  connect(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#connecting ??= this.#connect().finally(() => (this.#connecting = undefined));
    return this.#connecting;
  }

  /** Before each tool call: back online, and the party taken again when it is not held yet. */
  async ensure(): Promise<void> {
    if (this.#closed) return;
    if (!this.#ws || (this.party && !this.session)) await this.connect();
  }

  async #connect(): Promise<void> {
    if (this.#closed) return;
    if (this.party && !this.session) {
      const r = await this.#open(true);
      if ("ws" in r) {
        this.#adopt(r.ws);
        this.session = String(r.hello.session);
        this.since = String(r.hello.at);
        if (this.refused) log(`took ${this.party}`);
        this.refused = undefined;
        log(`acting as ${this.party} (session ${this.session.slice(0, 8)}…) on ${this.config.api}`);
        return;
      }
      if (r.code === 4409 || r.code === 4422) {
        if (this.refused?.reason !== r.reason) log(`✗ ${r.reason}; reads work, writes are refused until it is free`);
        this.refused = r;
      } else {
        log(`✗ ${r.reason}; trying again in ${this.#backoff / 1000} s`);
        this.#later();
        return;
      }
    }
    // A reader: no party named, or the party held elsewhere — the events still come.
    if (this.#ws) return;
    const r = await this.#open(false);
    if ("ws" in r) {
      this.#adopt(r.ws);
      if (!this.party) log(`reading ${this.config.api} as nobody: writes wait for the as tool`);
    } else {
      log(`✗ ${r.reason}; trying again in ${this.#backoff / 1000} s`);
      this.#later();
    }
  }

  /** Opens a socket (taking the party, or not): its hello, or the close that came first. */
  #open(take: boolean): Promise<Opened> {
    const url = new URL(`${this.config.api}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (take && this.party) {
      url.searchParams.set("as", this.party);
      url.searchParams.set("label", this.label);
    }
    return new Promise<Opened>((resolve) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url.toString());
      } catch (e) {
        resolve({ code: 0, reason: (e as Error).message });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.onclose = null;
        ws.close();
        resolve({ code: 0, reason: `the specs-bot api at ${this.config.api} gave no hello in ${this.config.timeoutMs} ms` });
      }, this.config.timeoutMs);
      ws.onmessage = (e) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (!settled) {
          if (m.type !== "hello") return;
          settled = true;
          clearTimeout(timer);
          resolve({ ws, hello: m });
          return;
        }
        if (typeof m.type === "string" && !["hello", "subscribed", "pong", "error"].includes(m.type)) this.#receive(m as Event);
      };
      ws.onclose = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: e.code, reason: e.reason || `the specs-bot api at ${this.config.api} is unreachable` });
      };
    });
  }

  #adopt(ws: WebSocket): void {
    const old = this.#ws;
    this.#ws = ws;
    this.#backoff = 1000;
    if (old) {
      old.onclose = null;
      old.close(1000);
    }
    ws.onclose = (e) => {
      if (this.#ws !== ws || this.#closed) return;
      this.#ws = undefined;
      this.session = undefined;
      log(`disconnected (${e.code}${e.reason ? ` ${e.reason}` : ""}); trying again in ${this.#backoff / 1000} s`);
      this.#later();
    };
  }

  #later(): void {
    if (this.#timer || this.#closed) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.connect();
    }, this.#backoff);
    this.#backoff = Math.min(this.#backoff * 2, 30_000);
  }

  /** Not this party's own doing. */
  #others(e: Event): boolean {
    if (!this.party) return true;
    return e.type === "chat" ? e.from !== this.party : e.party !== this.party;
  }

  /** What an agent hears between calls: others' writes, machines coming and going, chat to it or to all. */
  #relevant(e: Event): boolean {
    if (!this.#others(e)) return false;
    return e.type !== "chat" || !this.party || e.to === this.party || e.to === "all";
  }

  #receive(e: Event): void {
    for (const w of this.#waiters) if (w(e)) return;
    if (!this.#relevant(e)) return;
    this.#events.push(e);
    if (this.#events.length > MAX_BUFFER) {
      this.#events.shift();
      this.#dropped++;
    }
  }

  /** The events since the previous call, and how many were dropped from a full buffer; the buffer starts again. */
  drain(): { events: Event[]; dropped: number } {
    const out = { events: this.#events, dropped: this.#dropped };
    this.#events = [];
    this.#dropped = 0;
    return out;
  }

  matches(f: WaitFilter, e: Event): boolean {
    if (!this.#others(e)) return false;
    if (f.types?.length && !f.types.includes(e.type)) return false;
    if (f.to && e.type === "chat") return e.to === f.to || e.to === "all";
    return true;
  }

  /** The next event matching `f` — one already waiting in the buffer first — or undefined after `ms`. */
  wait(f: WaitFilter, ms: number, signal?: AbortSignal): Promise<Event | undefined> {
    const at = this.#events.findIndex((e) => this.matches(f, e));
    if (at >= 0) return Promise.resolve(this.#events.splice(at, 1)[0]);
    return new Promise((resolve) => {
      const done = (e: Event | undefined) => {
        clearTimeout(timer);
        this.#waiters.delete(waiter);
        signal?.removeEventListener("abort", abort);
        resolve(e);
      };
      const waiter = (e: Event) => {
        if (!this.matches(f, e)) return false;
        done(e);
        return true;
      };
      const abort = () => done(undefined);
      const timer = setTimeout(() => done(undefined), ms);
      this.#waiters.add(waiter);
      signal?.addEventListener("abort", abort);
    });
  }

  /** Lets go of the party (the socket's close releases the lease). */
  close(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#ws?.close(1000, "bye");
    this.#ws = undefined;
  }
}

// ── tools ────────────────────────────────────────────────────────────────────────────────────────────────

type Schema = Record<string, unknown>;
type Args = Record<string, unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, Schema>; required?: string[] };
  write?: boolean;
  run: (a: Args, extra: { signal?: AbortSignal }) => Promise<string>;
}

const str = (description: string): Schema => ({ type: "string", description });
const int = (description: string): Schema => ({ type: "integer", description });
const bool = (description: string): Schema => ({ type: "boolean", description });
const strs = (description: string): Schema => ({ type: "array", items: { type: "string" }, description });
const oneOf = (values: string[], description: string): Schema => ({ type: "string", enum: values, description });

const enc = encodeURIComponent;
const s = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

/** What a write must not be sent without, said once. */
export class Refused extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

export function tools(config: ClientConfig, link: Link): Tool[] {
  /** One call with this process's session; a session the api forgot (a restart) is taken again, once. */
  const call = async (path: string, opts: { query?: Query; body?: unknown; method?: "DELETE" }) => {
    try {
      return await request(config, link.session, path, opts);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401 && e.message === "unknown session")) throw e;
      link.session = undefined;
      await link.ensure();
      return request(config, link.session, path, opts);
    }
  };

  const read = (
    name: string,
    description: string,
    properties: Record<string, Schema>,
    required: string[],
    path: (a: Args) => string,
    query: (a: Args) => Query = () => ({}),
    // What the agent is shown of the answer: the api's, trimmed where it is long (tokens are the agent's budget).
    shape: (v: unknown, a: Args) => unknown = (v) => v,
  ): Tool => ({
    name,
    description,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    run: async (a) => render(shape(await call(path(a), { query: query(a) }), a), "toon"),
  });

  /** A write goes only with the party this session holds; otherwise why not, said once. */
  const holding = () => {
    if (!link.party) {
      throw new Refused("this session holds no party yet", "call the as tool with yours first (maintainer, machine-1, machine-2); it is held until the session ends");
    }
    if (link.refused) {
      throw new Refused(
        link.refused.reason,
        link.refused.code === 4409
          ? `one session per party: ${link.party} comes back when that session ends; the next call tries again`
          : "as names a party the api does not know (maintainer, machine-1, machine-2)",
      );
    }
    if (!link.session) throw new Refused(`the specs-bot api at ${config.api} is unreachable, so ${link.party} is not taken`, "the next call tries again");
  };

  const COMMON = {
    apply: bool("write it; without it (the default) a dry run that returns the diff and writes nothing"),
    landed: strs("the code commit(s) this write goes with, as repo@sha; kept in the commit, never in the text"),
  };
  const write = (name: string, cli: string, description: string, properties: Record<string, Schema>, required: string[]): Tool => ({
    name,
    description,
    write: true,
    inputSchema: { type: "object", properties: { ...properties, ...COMMON }, required },
    run: async (a) => {
      holding();
      const { op, body } = writeBody(cli, a as WriteArgs);
      return printWrite((await call(`write/${op}`, { body })) as WriteAnswer, "toon", "call again with apply: true to write it");
    },
  });

  const FIELD_PROPS = {
    measured: str("what was observed, re-runnable"),
    options: str("(a) … (b) …"),
    recommendation: str("the most restrictive reading (decision 67)"),
    blocks: str("what waits on the answer"),
  };

  const who = () => render({ party: link.party ?? null, session: link.session ? "held" : null, since: link.since ?? null }, "toon");
  return [
    {
      name: "as",
      description: "take a party for this session (call it first): held until the session ends; refused while another session holds it",
      inputSchema: { type: "object", properties: { party: str("maintainer, machine-1 or machine-2") }, required: ["party"] },
      run: async (a) => {
        await link.take(s(a.party) ?? "");
        if (link.refused) throw new Refused(link.refused.reason, link.refused.code === 4409 ? "one session per party: it comes back when that session ends; a write tries again" : "one of maintainer, machine-1, machine-2");
        if (!link.session) throw new Refused(`the specs-bot api at ${config.api} is unreachable`, "call as again");
        return who();
      },
    },
    {
      name: "logout",
      description: "let go of this session's party (another session can take it); reads go on",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        await link.release();
        return who();
      },
    },
    {
      name: "whoami",
      description: "who this MCP server acts as: party, session, since, the api and its health",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const health = await call("health", {}).catch((e: Error) => ({ error: e.message }));
        const state = !link.party
          ? "no party: call as with yours"
          : link.session
            ? "holding the party"
            : link.refused
              ? link.refused.reason
              : "offline; the next call tries again";
        return render({ api: config.api, party: link.party ?? null, session: link.session ?? null, since: link.since ?? null, state, health }, "toon");
      },
    },
    {
      name: "doing",
      description: "say what you are doing now (shown live on the site); a new line ends the last as done",
      inputSchema: { type: "object", properties: { text: str("one line, ≤200 chars"), front: str("front folder or number") }, required: ["text"] },
      run: async (a) => {
        holding();
        const r = (await call("doing", { body: { text: s(a.text) ?? "", ...(s(a.front) ? { front: s(a.front) } : {}) } })) as Parameters<typeof printDoing>[0];
        return printDoing(r, "toon");
      },
    },
    {
      name: "done",
      description: "end what you said you are doing: done, or paused to resume",
      inputSchema: { type: "object", properties: { paused: { type: "boolean", description: "stopped for now" } } },
      run: async (a) => {
        holding();
        const r = (await call("doing", { method: "DELETE", ...(a.paused === true ? { query: { paused: true } } : {}) })) as { party: string };
        return printDoing({ party: r.party, doing: null }, "toon");
      },
    },
    read("overview", "counts of the current milestone", {}, [], () => "overview"),
    read("next", "the next free decision number, and whether the files agree", {}, [], () => "next"),
    read(
      "search",
      "full-text search over steps, pending questions, subjects, retired forms, doc sections and messages",
      {
        q: str("what to look for; a code like for-await-one-source is matched word for word first"),
        kind: str("step,pending,subject,retired,section,message (comma-separated)"),
        version: str("only this milestone's sections"),
        owner: str("only the sections of fronts this machine owns (machine-1, …)"),
        front: str("only this front's sections"),
        frozen: bool("include closed milestones' sections"),
        limit: int("how many hits (10)"),
      },
      ["q"],
      () => "search",
      (a) => ({ q: s(a.q), kind: s(a.kind), version: s(a.version), owner: s(a.owner), front: s(a.front), frozen: a.frozen === true, limit: s(a.limit) }),
    ),
    read("step", "one decision row whole: rule, binds, cell, who supersedes it, subjects and retired forms citing it", { n: int("the decision number") }, ["n"], (a) => `steps/${enc(String(a.n))}`),
    read(
      "steps",
      "list decision rows",
      {
        section: str("the ## section of the record"),
        status: oneOf(["in-force", "overtaken", "replaced", "reversed", "superseded"], "only rows of this status"),
        q: str("rows whose id, rule or binds contain it"),
        limit: int("how many (20)"),
        offset: int("skip this many"),
      },
      [],
      () => "steps",
      (a) => ({ section: s(a.section), status: s(a.status), q: s(a.q), limit: s(a.limit) ?? "20", offset: s(a.offset) }),
    ),
    read(
      "pending",
      "the open questions by section, or one of them whole (with its etag)",
      { id: str("one open question"), section: str("sections whose heading contains it") },
      [],
      (a) => (s(a.id) ? `pending/${enc(String(a.id))}` : "pending"),
      (a) => (s(a.id) ? {} : { section: s(a.section) }),
    ),
    read(
      "review",
      "the To review table, 20 at a time",
      { open: bool("only the items not yet reviewed"), limit: int("how many (20)"), offset: int("skip this many") },
      [],
      () => "review",
      (a) => ({ open: a.open === true, limit: s(a.limit) ?? "20", offset: s(a.offset) }),
    ),
    read("subject", "the subjects of the rules in force, or one of them whole", { slug: str("one subject of decisions-taken") }, [], (a) => (s(a.slug) ? `subjects/${enc(String(a.slug))}` : "subjects")),
    read("retired", "forms the language, std, libraries or process retired, and what replaced each", { q: str("retired forms whose text contains it") }, [], () => "retired", (a) => ({ q: s(a.q) })),
    read(
      "fronts",
      "the fronts of a milestone",
      { version: str("the milestone (the current one by default)"), owner: str("only the fronts this machine owns (machine-1, …); none for the unassigned") },
      [],
      () => "fronts",
      (a) => ({ version: s(a.version), owner: s(a.owner) }),
    ),
    read(
      "front",
      "one front: its folders' documents and the in-force rows that bind it",
      { num: str("the front's number"), version: str("the milestone (the current one by default)") },
      ["num"],
      (a) => `fronts/${enc(String(a.num))}`,
      (a) => ({ version: s(a.version) }),
    ),
    read(
      "doc",
      "a document: its outline by default, one section (with its etag), or whole",
      {
        ref: str("e.g. 150-rakun/README, milestone/status"),
        section: str("an anchor from the outline"),
        whole: bool("the whole text (refused past ~8k tokens unless force)"),
        force: bool("whole, however long"),
        depth: int("outline down to this heading level (2)"),
      },
      ["ref"],
      (a) => `docs/${String(a.ref).split("/").map(enc).join("/")}`,
      // Without a section the outline: a whole README can be 30k tokens.
      (a) => (s(a.section) ? { section: s(a.section) } : a.whole === true ? {} : { outline: true }),
      (v, a) => {
        const d = v as { ref: string; title: string; meta?: unknown; outline?: { level: number; heading: string; anchor: string }[]; text?: string };
        if (s(a.section)) return v;
        // The outline down to depth (## by default): each section's anchor (the heading, spelled as a link) and how many
        // deeper ones it holds — a README of 150 steps is a few hundred tokens, not thousands.
        const all = d.outline ?? [];
        const depth = Number(a.depth ?? 2);
        const outline = all.flatMap((o, i) => {
          if (o.level > depth) return [];
          let deeper = 0;
          for (let j = i + 1; j < all.length && all[j]!.level > o.level; j++) if (all[j]!.level > depth) deeper++;
          return [{ level: o.level, anchor: o.anchor, deeper }];
        });
        if (a.whole === true && d.text !== undefined) {
          if (d.text.length > 32_000 && a.force !== true) {
            return { ref: d.ref, title: d.title, refused: `whole is ~${Math.round(d.text.length / 4)} tokens: read sections, or whole with force: true`, outline };
          }
          return { ref: d.ref, title: d.title, ...(d.meta ? { meta: d.meta } : {}), text: d.text };
        }
        return { ref: d.ref, title: d.title, outline };
      },
    ),
    read(
      "chat",
      "the conversation between the machines and the maintainer, newest first, or one message whole",
      {
        id: str("one message, whole"),
        to: str("messages to this party (machine-1, machine-2, maintainer, …)"),
        unread: str("messages this party has not read"),
        limit: int("how many (10)"),
      },
      [],
      (a) => (s(a.id) ? `chat/${enc(String(a.id))}` : "chat"),
      (a) => (s(a.id) ? {} : { to: s(a.to), unread: s(a.unread), limit: s(a.limit) ?? "10" }),
      // The list without who has read what: one line a message.
      (v, a) => (s(a.id) ? v : { messages: ((v as { messages: Record<string, unknown>[] }).messages ?? []).map(({ read: _, ...m }) => m) }),
    ),
    read(
      "check",
      "the conventions' rules over the repository: counts, and the errors (warnings with severity)",
      { severity: oneOf(["error", "warning"], "list this severity's findings") },
      [],
      () => "check",
      (a) => ({ severity: s(a.severity) }),
      // The warnings are known and many (70): only counted unless asked for.
      (v, a) => {
        const c = v as { summary: unknown; findings: { severity: string }[] };
        return s(a.severity) ? v : { summary: c.summary, errors: c.findings.filter((f) => f.severity === "error") };
      },
    ),
    read("sessions", "which session holds which party now", {}, [], () => "sessions"),
    read("online", "the machines connected to the api's websocket now", {}, [], () => "presence"),
    {
      name: "wait",
      description: "block until the next event (a write, a chat message, a machine coming or going) or a timeout — like specs-bot watch --once",
      inputSchema: {
        type: "object",
        properties: {
          types: { type: "array", items: { type: "string", enum: ["write", "chat", "presence"] }, description: "only these event types (all by default)" },
          to: str("chat to this party (and to all) only; this server's own party by default"),
          all: bool("chat to anyone, not only to this party"),
          timeout: int("give up after this many seconds (600 by default, 1800 at most)"),
        },
      },
      run: async (a, extra) => {
        const timeoutS = Math.min(Math.max(Number(a.timeout ?? 600) || 600, 1), 1800);
        const types = Array.isArray(a.types) ? a.types.map(String) : undefined;
        const to = a.all === true ? undefined : (s(a.to) ?? link.party);
        const started = Date.now();
        const event = await link.wait({ ...(types ? { types } : {}), ...(to ? { to } : {}) }, timeoutS * 1000, extra.signal);
        const waited = `${Math.round((Date.now() - started) / 1000)} s`;
        return render(event ? { event, waited } : { event: null, timeout: true, waited }, "toon");
      },
    },
    // ── writes ──
    write(
      "edit",
      "edit",
      "replace one section of a document (its heading line included); needs the etag doc showed",
      {
        ref: str("the document"),
        section: str("the section to replace (its anchor)"),
        text: str("the section's new text, starting with its heading"),
        etag: str("the etag doc <ref> section showed; a section changed since is refused"),
      },
      ["ref", "section", "text", "etag"],
    ),
    write(
      "append",
      "append",
      "add text at the end of a section; a list item joins the list the section ends with",
      { ref: str("the document"), section: str("the section to add to (its anchor)"), text: str("what to add") },
      ["ref", "section", "text"],
    ),
    write(
      "add_section",
      "add-section",
      "insert a new section into a document after another",
      {
        ref: str("the document"),
        after: str("the anchor of the section the new one follows"),
        heading: str("the new section's heading, without the #"),
        text: str("the new section's body"),
        level: int("2 to 6 (default: the level of after)"),
      },
      ["ref", "after", "heading", "text"],
    ),
    write(
      "new_doc",
      "new-doc",
      "create a document in the current milestone, beside existing documents",
      { ref: str("the new document's ref"), text: str("the document, starting with its title (# …)") },
      ["ref", "text"],
    ),
    write(
      "meta",
      "meta",
      "set or remove keys of a document's metadata block (the YAML at its top)",
      {
        ref: str("the document"),
        set: { type: "object", additionalProperties: { type: "string" }, description: "keys and their values (owner: machine-2, priority: high)" },
        unset: strs("keys to remove"),
      },
      ["ref"],
    ),
    write(
      "pending_add",
      "pending-add",
      "open a question in decisions-pending.md (measured, options, recommendation and blocks all required)",
      {
        id: str("a new id, never used (e.g. 956-b)"),
        section: str("the pending section: its heading or words only it contains (\"machine 1\")"),
        title: str("the question in one line"),
        ...FIELD_PROPS,
      },
      ["id", "section", "title", "measured", "options", "recommendation", "blocks"],
    ),
    write(
      "pending_edit",
      "pending-edit",
      "revise an open question's title or fields; the others are kept",
      { id: str("the open question"), etag: str("the etag pending <id> showed"), title: str("a new title"), ...FIELD_PROPS },
      ["id", "etag"],
    ),
    write(
      "pending_withdraw",
      "pending-withdraw",
      "remove a question nobody will answer",
      { id: str("the open question"), reason: str("why it leaves without an answer (kept in the commit)") },
      ["id", "reason"],
    ),
    write(
      "answer",
      "answer",
      "record a decision: the next free number, in the record; a machine's decision is marked for review",
      {
        id: str("the pending id it answers (it leaves the page), or a new id for a ruling no question asked"),
        rule: str("the rule as decided, one row (**Bold lead.** then the text)"),
        binds: str("the fronts and steps it binds (`machine-1/144` B-162 · …)"),
        cell: str("the conformance cell's slug (decision 647)"),
        process: bool("a row that fixes no program behaviour"),
        by: str("who decided, as the Id cell says it (default: the maintainer, or the coordinator †)"),
        subject: str("the subject of decisions-taken.md the row joins (its Steps and Binds)"),
        subjectText: str("the sentence the subject gains"),
      },
      ["id", "rule", "binds"],
    ),
    write(
      "supersede",
      "supersede",
      "mark a row overtaken, replaced or reversed by a later one (its text is kept)",
      { n: int("the row that stops being in force"), by: int("the later row in force"), kind: oneOf(["overtaken", "replaced", "reversed"], "how") },
      ["n", "by", "kind"],
    ),
    write("reviewed", "reviewed", "mark a delegated decision reviewed (the maintainer)", { n: int("the step in the To review table") }, ["n"]),
    write(
      "retire",
      "retire",
      "add a retired form",
      {
        area: str("the retired.md area (\"language spellings\", \"process\" …)"),
        retired: str("the form retired"),
        replacedBy: str("what replaces it"),
        decisions: str("the rows it comes from (\"606 (1), 609\")"),
        note: str("since when, or a note"),
      },
      ["area", "retired", "replacedBy", "decisions"],
    ),
    write(
      "send",
      "send",
      "write a message in the conversation; the machines hear it at once",
      {
        to: oneOf(["maintainer", "machine-1", "machine-2", "all"], "who it is for"),
        purpose: oneOf(["report", "question", "answer", "digest", "rule"], "what kind of message"),
        subject: str("one line saying what the message is for"),
        text: str("the message (a report: Done, Running, Next, Blocking)"),
        replyTo: str("the message it answers (m1-0024)"),
      },
      ["to", "purpose", "subject", "text"],
    ),
    write("mark_read", "mark-read", "mark a message to this party read", { id: str("the message") }, ["id"]),
    write("new-front", "new_front", "open a front in the current milestone", { front: str("folder: a new number and a slug (168-library-check)"), text: str("its README, title first") }, ["front", "text"]),
    write("claim", "claim", "claim a front for this party", { front: str("the front's number") }, ["front"]),
    write("release", "release", "let go of a front this party claimed", { front: str("the front's number") }, ["front"]),
    write("assign", "assign", "give a front to a machine, whoever held it (the maintainer only)", { front: str("the front's folder (150-rakun) or its number"), to: str("the machine (machine-1, machine-2)") }, ["front", "to"]),
  ];
}

/** The answer, then what happened since the previous call. */
/** The first clause of a description, at most `max` characters: "a document: its outline …" stays whole when short. */
export function brief(text: string, max: number): string {
  let t = text.replace(/\s+/g, " ").trim();
  for (const cut of [" — ", "; ", ". "]) {
    const i = t.indexOf(cut);
    if (i >= 12) t = t.slice(0, i);
  }
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Fields whose name says it all carry no description in the list. */
const PLAIN = new Set(["ref", "id", "text", "q", "n", "num", "front", "party", "to", "subject", "title", "etag", "apply", "landed", "limit", "offset", "version", "slug", "heading", "after", "level", "reason", "purpose"]);

function briefSchema(schema: Tool["inputSchema"]): Tool["inputSchema"] {
  const properties = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([k, v]) => {
      const p = { ...(v as Record<string, unknown>) };
      if (PLAIN.has(k)) delete p.description;
      else if (typeof p.description === "string") p.description = brief(p.description.replace(/\s*\([^)]*\)/g, ""), 40);
      if (p.items && typeof p.items === "object") p.items = { type: (p.items as { type?: string }).type };
      return [k, p];
    }),
  );
  return { ...schema, properties };
}

/** One short line an event: the agent reads what happened, and asks for more only when it needs it. */
export function eventLine(e: Event): string {
  const r = e as unknown as Record<string, unknown>;
  if (e.type === "chat") return `chat ${r.id} ${r.from}→${r.to}: ${r.subject}`;
  if (e.type === "write") return `write ${r.party} ${r.op}: ${String(r.summary ?? "").slice(0, 100)}`;
  if (e.type === "presence") return `${r.party} ${r.online ? "online" : "offline"}`;
  return `${e.type} ${JSON.stringify(r).slice(0, 100)}`;
}

const EVENT_LINES = 10;

export function withEvents(text: string, drained: { events: Event[]; dropped: number }): string {
  // A message's own chat event says it; the write that filed it (chat.send, chat.read) would say it twice.
  const events = drained.events.filter((e) => !(e.type === "write" && String((e as unknown as { op?: string }).op).startsWith("chat.")));
  if (!events.length && !drained.dropped) return text;
  const shown = events.slice(-EVENT_LINES).map(eventLine);
  const more = events.length - shown.length + drained.dropped;
  return `${text}\n\n---\nevents:\n${shown.map((l) => `  ${l}`).join("\n")}${more ? `\n  +${more} more (wait or chat for them)` : ""}`;
}

export function errorText(e: unknown): string {
  if (e instanceof Refused) return render({ error: e.message, hint: e.hint }, "toon");
  if (e instanceof ApiError) {
    const { error: _, hint: __, ...rest } = (e.body ?? {}) as Record<string, unknown>;
    return render({ error: e.message, ...(e.hint ? { hint: e.hint } : {}), status: e.status, ...rest }, "toon");
  }
  return render({ error: (e as Error).message }, "toon");
}

const INSTRUCTIONS = `The botopink specs, through the specs-bot api (the only way to read or change them).
Answers are TOON. Writes are dry runs that return the diff unless apply: true; edits carry the etag a read showed.
Start by calling as with this session's party (maintainer, machine-1, …): it is held until the session ends, one session per party; whoami says which.
Each result ends, after a --- line, with the events since the previous call (writes by others, chat to this party, machines coming and going); wait blocks until the next one.`;

/** Runs the MCP server on stdio until stdin closes or a signal comes. */
export async function serveMcp(config: ClientConfig, version: string): Promise<void> {
  const link = new Link(config, sessionLabel(config));
  const list = tools(config, link);
  const byName = new Map(list.map((t) => [t.name, t]));

  const server = new Server({ name: "specs-bot", version }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  // The list every session carries in its context: each description cut to its first clause, each field's to a
  // short hint — the long forms stay here as the code's documentation.
  const listed = list.map(({ name, description, inputSchema }) => ({ name, description: brief(description, 90), inputSchema: briefSchema(inputSchema) }));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    if (!tool) return { isError: true, content: [{ type: "text", text: render({ error: `no tool ${req.params.name}` }, "toon") }] };
    await link.ensure();
    let text: string;
    let isError = false;
    try {
      text = await tool.run(req.params.arguments ?? {}, { signal: extra.signal });
    } catch (e) {
      text = errorText(e);
      isError = true;
    }
    return { ...(isError ? { isError } : {}), content: [{ type: "text", text: withEvents(text, link.drain()) }] };
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    link.close();
    await server.close().catch(() => undefined);
    // Let the close frame leave before the process does.
    setTimeout(() => process.exit(0), 50);
  };
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await server.connect(new StdioServerTransport());
  log(`ready: ${list.length} tools`);
  // The party is taken in the background: the client's initialize never waits on the api; the first call does.
  void link.connect();
}
