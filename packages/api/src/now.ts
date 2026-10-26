// What each party is doing now (PLAN.md § 5.8), for the site's /now page and `GET /api/now`:
// - "doing": one line a party says about its work (`POST /api/doing`), owned by the session that holds the party and
//   gone with it (released, silent past the TTL, its websocket closed).
// - the task journal: every doing line ends either done (`done`, or replaced by the next line) or paused
//   (`done --paused`, or its session ended under it); saying a paused line again resumes it. Done lines are kept
//   for DONE_FOR, paused ones for PAUSED_FOR, in `<data>/.git/specs-bot-now.json` (outside the history, so a
//   restart keeps them; what was running then comes back paused).
// - its last writes: a small ring fed by the bus's write events, seeded at startup from the data repository's log
//   (the commits' Op / Party trailers; the author is the party).
// - its owned fronts and its last messages, from the model in force.
// Every change goes out on the bus (`doing`, `session`), so the websocket relays it and the page follows.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { frontFor, git, type Model, PARTIES, WriteError } from "@specs-bot/core";
import type { NowData, NowParty, NowTask, NowWrite } from "@specs-bot/site";
import { Hono } from "hono";
import { type EventBus, now } from "./events.ts";
import type { Sessions, Vars } from "./sessions.ts";

export const DOING_MAX = 200;
/** Writes kept in memory, all parties together; each party shows its last PER_PARTY. */
const RING = 200;
const PER_PARTY = 10;
const CHAT = 5;
/** Commits read from the log at startup. */
const SEED = 50;
export const DONE_FOR = 24 * 3600_000;
export const PAUSED_FOR = 7 * 24 * 3600_000;
const JOURNAL_MAX = 500;

interface Doing {
  session: string;
  text: string;
  front: string | null;
  since: string;
}

export type Recent = NowWrite & { party: string };

export class Activity {
  #doing = new Map<string, Doing>();
  /** Ended doing lines (done or paused), oldest first. */
  #ended: NowTask[] = [];
  readonly #journal: string | undefined;
  /** Oldest first. */
  #recent: Recent[] = [];
  /** Settles once the log has been read (or could not be). */
  readonly ready: Promise<void>;

  constructor(
    readonly bus: EventBus,
    readonly sessions: Sessions,
    dataPath?: string,
  ) {
    this.#journal = dataPath ? join(dataPath, ".git", "specs-bot-now.json") : undefined;
    this.#load();
    sessions.onChange(({ lease, held }) => {
      bus.publish({ type: "session", party: lease.party, held, label: lease.label, since: lease.since, at: now() });
      if (!held) this.#lost(lease.party, lease.id);
    });
    bus.subscribe((e) => {
      if (e.type === "write") this.#remember({ party: e.party, op: e.op, summary: e.summary, refs: e.refs, commit: e.commit, at: e.at });
    });
    this.ready = dataPath ? this.seed(dataPath) : Promise.resolve();
  }

  #remember(r: Recent): void {
    if (this.#recent.some((x) => x.commit === r.commit)) return;
    this.#recent.push(r);
    if (this.#recent.length > RING) this.#recent.splice(0, this.#recent.length - RING);
  }

  /** The party's session ended: what it was doing is paused. */
  #lost(party: string, session: string): void {
    const d = this.#doing.get(party);
    if (d?.session !== session) return;
    this.#end(party, "paused");
    this.bus.publish({ type: "doing", party, text: null, front: null, at: now() });
  }

  /** The party's running line goes to the journal as `state`. */
  #end(party: string, state: "done" | "paused"): boolean {
    const d = this.#doing.get(party);
    if (!d) return false;
    this.#doing.delete(party);
    this.#ended.push({ party, text: d.text, front: d.front, state, since: d.since, at: now() });
    this.#save();
    return true;
  }

  #prune(at = Date.now()): void {
    this.#ended = this.#ended.filter((t) => at - Date.parse(t.at) < (t.state === "done" ? DONE_FOR : PAUSED_FOR)).slice(-JOURNAL_MAX);
  }

  #load(): void {
    if (!this.#journal) return;
    try {
      const j = JSON.parse(readFileSync(this.#journal, "utf8")) as { tasks?: NowTask[] };
      // What was running when the api stopped has no session any more: it is paused.
      this.#ended = (j.tasks ?? []).map((t) => (t.state === "running" ? { ...t, state: "paused" as const, at: t.at } : t));
      this.#prune();
    } catch {
      this.#ended = [];
    }
  }

  #save(): void {
    if (!this.#journal) return;
    this.#prune();
    const running = [...this.#doing].map(([party, d]): NowTask => ({ party, text: d.text, front: d.front, state: "running", since: d.since, at: d.since }));
    try {
      writeFileSync(this.#journal, JSON.stringify({ tasks: [...this.#ended, ...running] }));
    } catch {
      // A journal that cannot be written costs only the history across a restart.
    }
  }

  /** The last commits of the data repository, older than anything the bus brought meanwhile. */
  async seed(dataPath: string): Promise<void> {
    let out: string;
    try {
      out = await git(dataPath, ["log", `-n${SEED}`, "--name-only", `--format=${LOG_FORMAT}`]);
    } catch {
      return;
    }
    const known = new Set(this.#recent.map((r) => r.commit));
    const older = parseLog(out)
      .filter((r) => !known.has(r.commit))
      .reverse();
    this.#recent = [...older, ...this.#recent].slice(-RING);
  }

  /**
   * What `party` (its session `session`) is doing now; the same line again changes nothing and says nothing.
   * Another line ends the one before as done; a line the party paused is resumed (it leaves the paused list).
   */
  set(party: string, session: string, text: string, front: string | null): Doing {
    const before = this.#doing.get(party);
    if (before && before.session === session && before.text === text && before.front === front) return before;
    if (before && before.text !== text) this.#end(party, "done");
    const resumed = this.#ended.findLastIndex((t) => t.party === party && t.state === "paused" && t.text === text);
    if (resumed >= 0) this.#ended.splice(resumed, 1);
    const d: Doing = { session, text, front, since: now() };
    this.#doing.set(party, d);
    this.#save();
    this.bus.publish({ type: "doing", party, text, front, at: d.since });
    return d;
  }

  /** The party stops: its line is done, or `paused` to resume later. */
  clear(party: string, paused = false): boolean {
    if (!this.#end(party, paused ? "paused" : "done")) return false;
    this.bus.publish({ type: "doing", party, text: null, front: null, at: now() });
    return true;
  }

  /** Every party as it is now, over the model in force (none: no fronts, no chat). */
  snapshot(model: Model | undefined): NowData {
    const parties = PARTIES.map((party): NowParty => {
      // Asking for the holder lets go of a lease silent past the TTL (and so of its doing).
      const lease = this.sessions.holder(party);
      let doing = this.#doing.get(party);
      if (doing && doing.session !== lease?.id) {
        this.#end(party, "paused");
        doing = undefined;
      }
      return {
        party,
        online: lease !== undefined,
        session: lease ? { label: lease.label, since: lease.since, bound: lease.bound === true } : null,
        doing: doing ? { text: doing.text, front: doing.front, since: doing.since } : null,
        fronts: model ? model.fronts.filter((f) => f.version === model.tree.current && f.owner === party).map((f) => f.ref) : [],
        recent: this.#recent
          .filter((r) => r.party === party)
          .slice(-PER_PARTY)
          .reverse()
          .map(({ party: _, ...w }) => w),
        chat: model
          ? model.chat
              .filter((m) => m.from === party || m.to === party || m.to === "all")
              .slice(-CHAT)
              .reverse()
              .map((m) => ({ id: m.id, from: m.from, to: m.to, subject: m.subject, at: m.at }))
          : [],
      };
    });
    this.#prune();
    const newest = (a: NowTask, b: NowTask) => b.at.localeCompare(a.at);
    const running = parties.flatMap((p) => (p.doing ? [{ party: p.party, ...p.doing, state: "running" as const, at: p.doing.since }] : []));
    const ended = [...this.#ended].reverse();
    return { at: now(), parties, tasks: [...running.sort(newest), ...ended.filter((t) => t.state === "paused"), ...ended.filter((t) => t.state === "done")] };
  }
}

// ── the data repository's log ──────────────────────────────────────────────────────────────────────────────

/** One record per commit (\x1e), its fields split by \x1f, then the files it changed, one per line. */
export const LOG_FORMAT = "%x1e%h%x1f%an%x1f%aI%x1f%s%x1f%(trailers:key=Op,valueonly,separator=%x2C)%x1f%(trailers:key=Party,valueonly,separator=%x2C)";

/** The commits of `git log --name-only --format=LOG_FORMAT` made by a party, newest first. */
export function parseLog(out: string): Recent[] {
  const rows: Recent[] = [];
  for (const chunk of out.split("\x1e")) {
    const [head, ...files] = chunk.split("\n");
    if (!head?.trim()) continue;
    const [commit = "", author = "", at = "", subject = "", op = "", trailer = ""] = head.split("\x1f");
    const party = trailer.split(",")[0]!.trim() || author.trim();
    if (!(PARTIES as readonly string[]).includes(party)) continue;
    rows.push({
      party,
      op: op.split(",")[0]!.trim() || "commit",
      // "spec(1.0.12-beta): 150-rakun: claimed by machine-1" → "150-rakun: claimed by machine-1", as the write said it.
      summary: subject.replace(/^[\w.-]+\([^)]*\):\s*/, ""),
      refs: refsOf(files),
      commit,
      at,
    });
  }
  return rows;
}

/** The api's names for the files a commit changed: a document's ref, a message's id. */
function refsOf(files: string[]): string[] {
  const refs = new Set<string>();
  for (const f of files.map((x) => x.trim()).filter(Boolean)) {
    const msg = f.match(/^conversation-chat\/[^/]+\/.*-([a-z][a-z0-9]*-\d{4})\.md$/);
    if (msg) refs.add(`message ${msg[1]}`);
    else {
      const doc = f.match(/^specs\/(.+)\.md$/);
      if (doc) refs.add(doc[1]!);
    }
  }
  return [...refs];
}

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────────

/** GET /api/now · POST /api/doing {text, front?} · DELETE /api/doing[?paused=1]. */
export function nowRoutes(activity: Activity, model: () => Model | undefined) {
  const api = new Hono<{ Variables: Vars }>();

  api.get("/now", (c) => c.json(activity.snapshot(model())));

  api.post("/doing", async (c) => {
    const party = c.get("party");
    const session = c.get("session");
    if (!party) return c.json({ error: "saying what you are doing needs a party", hint: "specs-bot as <party> (the MCP server: the as tool)" }, 401);
    if (!session) return c.json({ error: "what a party is doing belongs to its session, and this request has none", hint: "specs-bot as <party> takes one" }, 401);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown; front?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return c.json({ error: "text is required: what this party is doing now, in one line" }, 422);
    if (text.length > DOING_MAX) return c.json({ error: `text is ${text.length} characters; at most ${DOING_MAX}` }, 422);
    let front: string | null = null;
    if (body?.front !== undefined && body.front !== null && body.front !== "") {
      const m = model();
      if (!m) return c.json({ error: "the specs could not be read, so no front can be named" }, 503);
      try {
        front = frontFor(m, String(body.front)).front.ref;
      } catch (e) {
        if (e instanceof WriteError) return c.json({ error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}) }, e.status as 404);
        throw e;
      }
    }
    const d = activity.set(party, session, text, front);
    return c.json({ party, doing: { text: d.text, front: d.front, since: d.since } });
  });

  // ?paused=1: stopped for now, to resume later; else done.
  api.delete("/doing", (c) => {
    const party = c.get("party");
    if (!party) return c.json({ error: "clearing what you are doing needs a party", hint: "specs-bot as <party>" }, 401);
    const paused = ["1", "true"].includes(c.req.query("paused") ?? "");
    return c.json({ party, cleared: activity.clear(party, paused), ...(paused ? { paused } : {}) });
  });

  return api;
}
