import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createApp } from "../src/app.ts";
import { EventBus, type SpecEvent } from "../src/events.ts";
import type { NowTask } from "@specs-bot/site";
import { Activity, parseLog } from "../src/now.ts";
import { Sessions } from "../src/sessions.ts";
import { websocket } from "../src/ws.ts";

const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md": "**The next free number is 2.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 | A rule | x |  |\n",
  "specs/decisions-pending.md": "the next free\nnumber, which is **2**.\n\n## Machine 1\n\nNone open.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 1\nBinds: x\n",
  "specs/retired.md": "# R\n",
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs\n",
  "specs/milestone/status.md": "---\nmilestone: 1.0.12-beta\n---\n# Status\n\n## Done\n\n- [x] a\n\n## Open\n\n- [ ] b\n",
  "specs/150-rakun/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n",
  "specs/163-meta-ci/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 163 — meta-ci\n",
  "conversation-chat/machine-1/20261021-1144-hello-from-the-maintainer-mt-0001.md":
    "---\nfrom: maintainer\nto: machine-1\npurpose: rule\nsubject: Hello from the maintainer\nread: [ ]\n---\n\nHi.\n",
  "conversation-chat/all/20261021-1200-to-everyone-mt-0002.md": "---\nfrom: maintainer\nto: all\npurpose: digest\nsubject: To everyone\nread: m1 [ ] · m2 [ ] · m3 [ ]\n---\n\nAll.\n",
};

async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawn(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}

/** A data repository: the fixture, then one commit by machine-2 as a write makes it, then one by hand. */
async function dataRepo(): Promise<{ root: string; seeded: string }> {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-now-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-qm", "init"]);
  writeFileSync(join(root, "specs/milestone/status.md"), `${FILES["specs/milestone/status.md"]}- [ ] c\n`);
  await git(root, ["commit", "-qam", "spec(1.0.12-beta): milestone/status: open c", "-m", "Op: doc.append\nParty: machine-2"], {
    GIT_AUTHOR_NAME: "machine-2",
    GIT_AUTHOR_EMAIL: "machine-2@specs-bot",
  });
  const seeded = await git(root, ["rev-parse", "--short", "HEAD"]);
  writeFileSync(join(root, "specs/retired.md"), "# R\n\nBy hand.\n");
  await git(root, ["commit", "-qam", "a fix by hand"]);
  return { root, seeded };
}

type Now = { at: string; parties: { party: string; online: boolean; session: any; doing: any; fronts: string[]; recent: any[]; chat: any[] }[] };

describe("/api/now and /api/doing", () => {
  let root: string;
  let seeded: string;
  let app: ReturnType<typeof createApp>;
  let clock = 0;
  const events: SpecEvent[] = [];

  beforeAll(async () => {
    ({ root, seeded } = await dataRepo());
    clock = Date.now();
    app = createApp({ host: "127.0.0.1", port: 0, dataPath: root, tokens: new Map([["tok-mt", "maintainer"]]) }, { sessions: new Sessions(60_000, () => clock) });
    app.bus.subscribe((e) => events.push(e));
    await app.activity.ready;
  });

  const call = async (method: string, path: string, body?: unknown, session?: string, token?: string) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(session ? { "x-specs-bot-session": session } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const take = async (party: string) => (await call("POST", "/api/session", { party, label: `host · ${party}` })).body.session as string;
  const now = async () => (await call("GET", "/api/now")).body as Now;
  const of = (n: Now, party: string) => n.parties.find((p) => p.party === party)!;

  test("every known party, with its fronts, its messages and its writes from the log", async () => {
    const n = await now();
    expect(n.parties.map((p) => p.party)).toEqual(["maintainer", "machine-1", "machine-2"]);
    expect(Date.parse(n.at)).not.toBeNaN();
    expect(of(n, "machine-1")).toMatchObject({ online: false, session: null, doing: null, fronts: ["150-rakun"], recent: [] });
    expect(of(n, "machine-1").chat.map((m: { id: string }) => m.id)).toEqual(["mt-0002", "mt-0001"]);
    expect(of(n, "machine-1").chat[1]).toEqual({ id: "mt-0001", from: "maintainer", to: "machine-1", subject: "Hello from the maintainer", at: "2026-10-21T11:44" });
    expect(of(n, "machine-2").chat.map((m: { id: string }) => m.id)).toEqual(["mt-0002"]);
    // The log's commit by machine-2 (its trailers); the commit by hand names no party and is left out.
    expect(of(n, "machine-2").recent).toEqual([{ op: "doc.append", summary: "milestone/status: open c", refs: ["milestone/status"], commit: seeded, at: expect.any(String) }]);
    expect(n.parties.flatMap((p) => p.recent).length).toBe(1);
    // The site's /now page renders the same.
    const page = await (await app.request("/now")).text();
    expect(page).toContain('id="now-machine-2"');
    expect(page).toContain("milestone/status: open c");
  });

  test("doing needs a party and a session", async () => {
    expect((await call("POST", "/api/doing", { text: "x" })).status).toBe(401);
    // A token names a party, but a doing belongs to a session.
    const r = await call("POST", "/api/doing", { text: "x" }, undefined, "tok-mt");
    expect(r.status).toBe(401);
    expect(r.body.hint).toContain("specs-bot as");
    expect((await call("DELETE", "/api/doing")).status).toBe(401);
  });

  test("a session sets, replaces and clears what its party is doing; each change is an event", async () => {
    const s = await take("machine-1");
    events.length = 0;
    const set = await call("POST", "/api/doing", { text: "  reading   the rakun\nrouter ", front: "150" }, s);
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ party: "machine-1", doing: { text: "reading the rakun router", front: "150-rakun" } });
    expect(events).toEqual([{ type: "doing", party: "machine-1", text: "reading the rakun router", front: "150-rakun", at: expect.any(String) }]);

    // The same line again says nothing.
    await call("POST", "/api/doing", { text: "reading the rakun router", front: "150-rakun" }, s);
    expect(events.length).toBe(1);

    let m1 = of(await now(), "machine-1");
    expect(m1.online).toBe(true);
    expect(m1.session).toEqual({ label: "host · machine-1", since: expect.any(String), bound: false });
    expect(m1.doing).toEqual({ text: "reading the rakun router", front: "150-rakun", since: expect.any(String) });

    expect((await call("POST", "/api/doing", { text: "x".repeat(201) }, s)).status).toBe(422);
    expect((await call("POST", "/api/doing", { text: "   " }, s)).status).toBe(422);
    const noFront = await call("POST", "/api/doing", { text: "y", front: "999" }, s);
    expect([noFront.status, noFront.body.code]).toEqual([404, "not-found"]);

    expect((await call("DELETE", "/api/doing", undefined, s)).body).toEqual({ party: "machine-1", cleared: true });
    expect(events.at(-1)).toMatchObject({ type: "doing", party: "machine-1", text: null, front: null });
    m1 = of(await now(), "machine-1");
    expect(m1.doing).toBeNull();
    expect((await call("DELETE", "/api/doing", undefined, s)).body.cleared).toBe(false);
    await call("DELETE", "/api/session", undefined, s);
  });

  test("the doing goes when the session lets go of the party", async () => {
    const s = await take("machine-2");
    await call("POST", "/api/doing", { text: "writing tests" }, s);
    events.length = 0;
    expect((await call("DELETE", "/api/session", undefined, s)).body.released).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["session", "doing"]);
    expect(events[0]).toMatchObject({ type: "session", party: "machine-2", held: false, label: "host · machine-2" });
    expect(events[1]).toMatchObject({ party: "machine-2", text: null });
    expect(of(await now(), "machine-2")).toMatchObject({ online: false, session: null, doing: null });
    // A new session starts with nothing said.
    await take("machine-2");
    expect(of(await now(), "machine-2").doing).toBeNull();
  });

  test("the doing goes when the session is silent past the TTL", async () => {
    const s = await take("maintainer");
    await call("POST", "/api/doing", { text: "reviewing" }, s);
    events.length = 0;
    clock += 61_000;
    app.sessions.sweep();
    expect(events.filter((e) => "party" in e && e.party === "maintainer").map((e) => [e.type, "party" in e ? e.party : ""])).toEqual([
      ["session", "maintainer"],
      ["doing", "maintainer"],
    ]);
    // Every other session went silent too.
    expect(of(await now(), "maintainer")).toMatchObject({ online: false, doing: null });
  });

  test("a write lands at the top of the party's recent writes", async () => {
    const s = await take("machine-1");
    const w = await call("POST", "/api/write/doc.append", { ref: "milestone/status", section: "done", text: "- [x] d", apply: true }, s);
    expect(w.status).toBe(200);
    const recent = of(await now(), "machine-1").recent;
    expect(recent[0]).toEqual({ op: "doc.append", summary: w.body.summary, refs: ["milestone/status#done"], commit: w.body.commit, at: expect.any(String) });
    await call("DELETE", "/api/session", undefined, s);
  });
});

describe("the log's commits", () => {
  test("a party's commit by its trailers, else by its author; refs from the files", () => {
    const out = [
      "",
      "abc1234\x1fmachine-1\x1f2026-10-26T10:00:00+00:00\x1fspec(1.0.12-beta): 150-rakun: claimed by machine-1\x1ffront.claim\x1fmachine-1\n\nspecs/150-rakun/README.md\n",
      "def5678\x1fmaintainer\x1f2026-10-26T09:00:00+00:00\x1fchat(machine-2): a question\x1f\x1f\n\nconversation-chat/machine-2/20261026-0900-a-question-mt-0040.md\n",
      "0001111\x1fsomeone\x1f2026-10-25T09:00:00+00:00\x1fby hand\x1f\x1f\n\nspecs/retired.md\n",
    ].join("\x1e");
    expect(parseLog(out)).toEqual([
      { party: "machine-1", op: "front.claim", summary: "150-rakun: claimed by machine-1", refs: ["150-rakun/README"], commit: "abc1234", at: "2026-10-26T10:00:00+00:00" },
      { party: "maintainer", op: "commit", summary: "a question", refs: ["message mt-0040"], commit: "def5678", at: "2026-10-26T09:00:00+00:00" },
    ]);
  });
});

describe("the websocket relays doing and session to whoever asks for them", () => {
  const bus = new EventBus();
  let server: ReturnType<typeof Bun.serve>;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp({ host: "127.0.0.1", port: 0, dataPath: "/nowhere", tokens: new Map() }, { bus });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
  });
  afterAll(() => void server.stop(true));

  function listen(query: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws${query}`);
    const got: any[] = [];
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
    const opened = new Promise<void>((r) => (ws.onopen = () => r()));
    return { ws, got, opened };
  }

  test("asked for: session taken, doing, cleared, let go; not asked for (an old client): none of them", async () => {
    const reader = listen("?types=write,chat,presence,doing,session");
    const old = listen("");
    await Promise.all([reader.opened, old.opened]);
    await Bun.sleep(50);

    const post = (path: string, body: unknown, session?: string, method = "POST") =>
      app.request(path, { method, headers: { "content-type": "application/json", ...(session ? { "x-specs-bot-session": session } : {}) }, body: JSON.stringify(body) });
    const { session } = (await (await post("/api/session", { party: "maintainer", label: "box" })).json()) as { session: string };
    // No model here: a doing without a front still works.
    expect((await post("/api/doing", { text: "porting the gate" }, session)).status).toBe(200);
    expect((await post("/api/doing", { text: "porting", front: "150" }, session)).status).toBe(503);
    await app.request("/api/session", { method: "DELETE", headers: { "x-specs-bot-session": session } });
    await Bun.sleep(150);

    const seen = reader.got.filter((m) => m.type !== "hello").map((m) => [m.type, m.party, m.held ?? m.text]);
    expect(seen).toEqual([
      ["session", "maintainer", true],
      ["doing", "maintainer", "porting the gate"],
      ["session", "maintainer", false],
      ["doing", "maintainer", null],
    ]);
    expect(old.got.map((m) => m.type)).toEqual(["hello"]);
    reader.ws.close();
    old.ws.close();
  });

  test("a websocket that takes a party: closing it ends the session, and the doing with it", async () => {
    const reader = listen("?types=doing,session");
    await reader.opened;
    const mcp = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws?as=machine-2&label=mcp`);
    const hello = await new Promise<{ session: string }>((r) => (mcp.onmessage = (e) => r(JSON.parse(String(e.data)))));
    const res = await app.request("/api/doing", { method: "POST", headers: { "content-type": "application/json", "x-specs-bot-session": hello.session }, body: JSON.stringify({ text: "via mcp" }) });
    expect(res.status).toBe(200);
    const live = (await (await app.request("/api/now")).json()) as Now;
    expect(live.parties.find((p) => p.party === "machine-2")).toMatchObject({ online: true, session: { label: "mcp", bound: true }, doing: { text: "via mcp" } });
    mcp.close();
    for (let i = 0; i < 50 && !reader.got.some((m) => m.type === "doing" && m.text === null); i++) await Bun.sleep(10);
    expect(reader.got.filter((m) => m.type !== "hello").map((m) => [m.type, m.held ?? m.text])).toEqual([
      ["session", true],
      ["doing", "via mcp"],
      ["session", false],
      ["doing", null],
    ]);
    reader.ws.close();
  });
});

describe("the task journal", () => {
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), "specs-bot-journal-"));
    mkdirSync(join(d, ".git"));
    return d;
  };
  const lease = (sessions: Sessions, party: string) => {
    const r = sessions.take(party, "t");
    if (!("lease" in r)) throw new Error("not taken");
    return r.lease.id;
  };
  const board = (a: Activity) => a.snapshot(undefined).tasks.map((t) => [t.state, t.party, t.text]);

  test("a new line ends the last as done; done --paused pauses; the same line again resumes; a lost session pauses", () => {
    const sessions = new Sessions();
    const a = new Activity(new EventBus(), sessions, dir());
    const m1 = lease(sessions, "machine-1");
    a.set("machine-1", m1, "phase 1", null);
    a.set("machine-1", m1, "phase 2", null);
    expect(board(a)).toEqual([["running", "machine-1", "phase 2"], ["done", "machine-1", "phase 1"]]);
    a.clear("machine-1", true);
    a.set("machine-1", m1, "961 (2)", null);
    expect(board(a)).toEqual([["running", "machine-1", "961 (2)"], ["paused", "machine-1", "phase 2"], ["done", "machine-1", "phase 1"]]);
    a.clear("machine-1");
    a.set("machine-1", m1, "phase 2", null);
    expect(board(a).map((t) => t.join(" "))).toEqual(["running machine-1 phase 2", "done machine-1 961 (2)", "done machine-1 phase 1"]);
    sessions.release(m1);
    expect(board(a)[0]).toEqual(["paused", "machine-1", "phase 2"]);
  });

  test("kept across a restart: what was running comes back paused; done lines older than 24 h are dropped", () => {
    const data = dir();
    const sessions = new Sessions();
    const a = new Activity(new EventBus(), sessions, data);
    const m2 = lease(sessions, "machine-2");
    a.set("machine-2", m2, "old", null);
    a.set("machine-2", m2, "cell check", null);
    const file = join(data, ".git", "specs-bot-now.json");
    const j = JSON.parse(readFileSync(file, "utf8")) as { tasks: NowTask[] };
    j.tasks[0]!.at = new Date(Date.now() - 25 * 3600_000).toISOString();
    writeFileSync(file, JSON.stringify(j));
    expect(board(new Activity(new EventBus(), new Sessions(), data))).toEqual([["paused", "machine-2", "cell check"]]);
  });
});
