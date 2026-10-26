import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApp } from "../src/app.ts";
import { EventBus, type SpecEvent } from "../src/events.ts";
import { matches, mountRealtime, parseFilter, websocket } from "../src/ws.ts";

const TOKENS = new Map([
  ["t1", "machine-1"],
  ["t2", "machine-2"],
]);

/** A connected test client: every message it receives, in order, awaited one by one. */
function connect(base: string, query = "", headers: Record<string, string> = {}) {
  const ws = new WebSocket(`${base}/api/ws${query}`, { headers } as unknown as string[]);
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  };
  const opened = new Promise<void>((resolve) => (ws.onopen = () => resolve()));
  const closed = new Promise<CloseEvent>((resolve) => (ws.onclose = (e) => resolve(e)));
  const next = (ms = 2000) =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("no message")), ms);
          waiters.push((m) => {
            clearTimeout(t);
            resolve(m);
          });
        });
  /** The next message of this type, skipping the others. */
  const nextOf = async (type: string) => {
    for (;;) {
      const m = await next();
      if (m.type === type) return m;
    }
  };
  const quiet = async (ms = 150) => {
    await Bun.sleep(ms);
    return inbox.splice(0);
  };
  return { ws, opened, closed, next, nextOf, quiet };
}

describe("/api/ws", () => {
  const bus = new EventBus();
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(() => {
    const app = createApp({ host: "127.0.0.1", port: 0, dataPath: "/nowhere", tokens: TOKENS }, { bus });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    base = `ws://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    // stop() answers a promise that waits on the sockets' close handshakes; the test does not need to wait.
    void server.stop(true);
  });

  test("an unknown token is closed with 4401", async () => {
    const c = connect(base, "?token=nope");
    expect((await c.closed).code).toBe(4401);
  });

  test("a token in the Authorization header names the party", async () => {
    const c = connect(base, "", { authorization: "Bearer t1" });
    expect(await c.next()).toMatchObject({ type: "hello", party: "machine-1" });
    c.ws.close();
    await c.closed;
  });

  test("a listener without a token is welcome, as nobody", async () => {
    const c = connect(base);
    expect(await c.next()).toMatchObject({ type: "hello", party: null });
    c.ws.close();
    await c.closed;
  });

  test("a party coming and going is presence, for the others and over HTTP", async () => {
    const watcher = connect(base, "?types=presence");
    await watcher.nextOf("hello");
    const m2 = connect(base, "?token=t2");
    expect(await watcher.next()).toMatchObject({ type: "presence", party: "machine-2", online: true });
    await m2.nextOf("hello");

    const res = await fetch(`http://127.0.0.1:${server.port}/api/presence`);
    const body = (await res.json()) as { online: { party: string; since: string; connections: number }[] };
    expect(body.online.map((p) => [p.party, p.connections])).toEqual([["machine-2", 1]]);
    expect(Date.parse(body.online[0]!.since)).not.toBeNaN();

    m2.ws.close();
    expect(await watcher.next()).toMatchObject({ type: "presence", party: "machine-2", online: false });
    watcher.ws.close();
    await watcher.closed;
  });

  test("a second connection of the same party is not a second arrival", async () => {
    const watcher = connect(base, "?types=presence");
    await watcher.nextOf("hello");
    const a = connect(base, "?token=t1");
    expect(await watcher.next()).toMatchObject({ party: "machine-1", online: true });
    const b = connect(base, "?token=t1");
    await b.nextOf("hello");
    b.ws.close();
    await b.closed;
    expect(await watcher.quiet()).toEqual([]);
    a.ws.close();
    expect(await watcher.next()).toMatchObject({ party: "machine-1", online: false });
    watcher.ws.close();
    await watcher.closed;
  });

  test("a published write reaches a subscribed client; a filtered-out chat does not", async () => {
    const c = connect(base, "?token=t2");
    await c.nextOf("hello");
    c.ws.send(JSON.stringify({ type: "subscribe", types: ["write"] }));
    // Its own arrival (presence) may come first, before it narrowed its filter.
    expect(await c.nextOf("subscribed")).toEqual({ type: "subscribed", types: ["write"], to: null });

    const chat: SpecEvent = { type: "chat", id: "m1-0025", from: "machine-1", to: "machine-2", purpose: "report", subject: "x", at: "t" };
    const write: SpecEvent = { type: "write", op: "doc.edit", party: "machine-1", commit: "abc1234", refs: ["milestone/status"], summary: "s", at: "t" };
    bus.publish(chat);
    bus.publish(write);
    expect(await c.next()).toEqual(write);
    expect(await c.quiet()).toEqual([]);
    c.ws.close();
    await c.closed;
  });

  test("chat filtered by addressee: messages to it and to all", async () => {
    const c = connect(base, "?token=t2&types=chat&to=machine-2");
    await c.nextOf("hello");
    const to = (who: string, id: string): SpecEvent => ({ type: "chat", id, from: "maintainer", to: who, purpose: "rule", subject: id, at: "t" });
    bus.publish(to("machine-1", "a"));
    bus.publish(to("machine-2", "b"));
    bus.publish(to("all", "c"));
    expect((await c.next()).id).toBe("b");
    expect((await c.next()).id).toBe("c");
    expect(await c.quiet()).toEqual([]);
    c.ws.close();
    await c.closed;
  });

  test("ping is answered with pong; bad JSON with an error", async () => {
    const c = connect(base);
    await c.nextOf("hello");
    c.ws.send(JSON.stringify({ type: "ping" }));
    expect(await c.next()).toMatchObject({ type: "pong" });
    c.ws.send("not json");
    expect(await c.next()).toMatchObject({ type: "error" });
    c.ws.close();
    await c.closed;
  });
});

describe("heartbeat", () => {
  test("a client answering the protocol pings stays connected across beats", async () => {
    const bus = new EventBus();
    const app = new Hono();
    const hub = mountRealtime(app, TOKENS, bus, { heartbeatMs: 40 });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    const c = connect(`ws://127.0.0.1:${server.port}`, "?token=t1");
    await c.nextOf("hello");
    await Bun.sleep(250);
    expect(hub.size).toBe(1);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
    await c.closed;
    await Bun.sleep(20);
    expect(hub.size).toBe(0);
    server.stop(true);
  });
});

describe("filters", () => {
  const write: SpecEvent = { type: "write", op: "x", party: "p", commit: "c", refs: [], summary: "", at: "t" };

  test("parseFilter keeps known types only, from a list or a comma string", () => {
    expect([...parseFilter("write,nope,chat", "")!.types!]).toEqual(["write", "chat"]);
    expect(parseFilter(["presence"], "machine-1")).toEqual({ types: new Set(["presence"]), to: "machine-1" });
    expect(parseFilter(undefined, undefined)).toEqual({});
  });

  test("`to` narrows chat only", () => {
    expect(matches({ to: "machine-1" }, write)).toBe(true);
  });
});
