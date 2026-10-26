import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { EventBus } from "../src/events.ts";
import { identify, mountSessions, partyOf, Sessions, type Vars } from "../src/sessions.ts";
import { mountRealtime, websocket } from "../src/ws.ts";

describe("Sessions — one party per session, one session per party", () => {
  test("a party is taken once; the holder gets it back, another session is told who holds it", () => {
    const s = new Sessions();
    const a = s.take("machine-1", "host · ~/a");
    if (!("lease" in a)) throw new Error("not taken");
    expect(s.take("machine-1", "host · ~/b")).toMatchObject({ held: { label: "host · ~/a" } });
    expect(s.take("machine-1", "host · ~/a", a.lease.id)).toEqual({ lease: a.lease });
    expect(s.take("nobody", "x")).toEqual({ unknown: true });
  });

  test("a session that takes another party lets the first go", () => {
    const s = new Sessions();
    const a = s.take("machine-1", "a");
    if (!("lease" in a)) throw new Error("not taken");
    const b = s.take("machine-2", "a", a.lease.id);
    expect("lease" in b).toBe(true);
    expect(s.holder("machine-1")).toBeUndefined();
    expect(s.touch(a.lease.id)).toBeUndefined();
  });

  test("silence past the TTL frees a party; a websocket-bound lease lasts while it is open", () => {
    let t = 0;
    const s = new Sessions(1000, () => t);
    s.take("machine-1", "cli");
    s.take("machine-2", "mcp", undefined, true);
    t = 5000;
    expect(s.holder("machine-1")).toBeUndefined();
    expect(s.holder("machine-2")?.label).toBe("mcp");
    expect(s.list().map((l) => l.party)).toEqual(["machine-2"]);
  });

  test("a token names its party, but not while a session holds it", () => {
    const s = new Sessions();
    const tokens = new Map([["t2", "machine-2"]]);
    expect(partyOf(s, tokens, undefined, "t2")).toEqual({ party: "machine-2" });
    s.take("machine-2", "host · mcp");
    expect(partyOf(s, tokens, undefined, "t2")).toMatchObject({ status: 409 });
    expect(partyOf(s, tokens, undefined, "nope")).toMatchObject({ error: "unknown token", status: 401 });
    expect(partyOf(s, tokens, "gone", undefined)).toMatchObject({ error: "unknown session", status: 401 });
  });
});

function app() {
  const sessions = new Sessions();
  const a = new Hono();
  mountRealtime(a, sessions, new Map(), new EventBus());
  const api = new Hono<{ Variables: Vars }>();
  api.use("*", identify(sessions, new Map()));
  mountSessions(api, sessions);
  api.get("/whoami", (c) => c.json({ party: c.get("party") ?? null }));
  a.route("/api", api);
  return { app: a, sessions };
}

describe("the session routes", () => {
  test("POST /api/session takes a party; the id names it; DELETE lets it go", async () => {
    const { app: a } = app();
    const take = (party: string, session?: string) =>
      a.request("/api/session", { method: "POST", body: JSON.stringify({ party, label: "t" }), headers: { "content-type": "application/json", ...(session ? { "x-specs-bot-session": session } : {}) } });
    const r = await take("machine-1");
    const { session } = (await r.json()) as { session: string };
    expect((await (await a.request("/api/whoami", { headers: { "x-specs-bot-session": session } })).json())).toEqual({ party: "machine-1" });
    const second = await take("machine-1");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { holder: { label: string } }).holder.label).toBe("t");
    expect((await take("machine-9")).status).toBe(422);
    expect(await (await a.request("/api/sessions")).json()).toMatchObject({ sessions: [{ party: "machine-1", label: "t" }] });
    expect(await (await a.request("/api/session", { method: "DELETE", headers: { "x-specs-bot-session": session } })).json()).toEqual({ released: true });
    expect((await take("machine-1")).status).toBe(200);
  });
});

describe("a websocket that takes a party (?as=)", () => {
  test("holds it while open, refuses a second one, and lets it go on close", async () => {
    const { app: a, sessions } = app();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: a.fetch, websocket });
    const open = (q: string) =>
      new Promise<{ ws: WebSocket; first: Promise<{ hello?: { session?: string; party?: string }; closed?: { code: number; reason: string } }> }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws${q}`);
        const first = new Promise<{ hello?: { session?: string; party?: string }; closed?: { code: number; reason: string } }>((done) => {
          ws.onmessage = (e) => done({ hello: JSON.parse(String(e.data)) });
          ws.onclose = (e) => done({ closed: { code: e.code, reason: e.reason } });
        });
        resolve({ ws, first });
      });
    const one = await open("?as=machine-1&label=mcp%20one");
    const hello = (await one.first).hello!;
    expect(hello.party).toBe("machine-1");
    expect(sessions.holder("machine-1")?.label).toBe("mcp one");
    // The session id also works over HTTP while the connection is open.
    expect(await (await a.request("/api/whoami", { headers: { "x-specs-bot-session": hello.session! } })).json()).toEqual({ party: "machine-1" });

    const two = await open("?as=machine-1&label=mcp%20two");
    expect((await two.first).closed).toMatchObject({ code: 4409 });

    one.ws.close();
    for (let i = 0; i < 50 && sessions.holder("machine-1"); i++) await Bun.sleep(10);
    expect(sessions.holder("machine-1")).toBeUndefined();
    server.stop(true);
  });
});
