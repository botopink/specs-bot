import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../../api/src/app.ts";
import { EventBus } from "../../api/src/events.ts";
import { websocket } from "../../api/src/ws.ts";
import { EXIT, parseTypes, renderEvent, watch, wsUrl } from "../src/watch.ts";

describe("wsUrl", () => {
  test("http becomes ws, https wss, with the filter in the query", () => {
    expect(wsUrl("http://192.168.1.15:7165/api", {})).toBe("ws://192.168.1.15:7165/api/ws");
    expect(wsUrl("https://specs.example/api/", { types: ["chat"], to: "machine-2" })).toBe("wss://specs.example/api/ws?types=chat&to=machine-2");
  });
});

describe("parseTypes", () => {
  test("refuses an unknown type", () => {
    expect(parseTypes("write,chat")).toEqual(["write", "chat"]);
    expect(() => parseTypes("write,nope")).toThrow("unknown event type nope");
    expect(parseTypes(undefined)).toBeUndefined();
  });
});

describe("renderEvent", () => {
  const chat = { type: "chat", id: "m1-0025", from: "machine-1", to: "machine-2", purpose: "report", subject: "Rebased", at: "2026-10-25T20:00:00.123Z" };

  test("json is one line per event", () => {
    expect(renderEvent(chat, "json")).toBe(JSON.stringify(chat));
  });

  test("text is one readable line", () => {
    expect(renderEvent(chat, "text")).toBe("2026-10-25 20:00:00Z chat m1-0025 machine-1 → machine-2 (report) — Rebased");
    expect(renderEvent({ type: "presence", party: "machine-2", online: false, at: "2026-10-25T20:00:00Z" }, "text")).toBe(
      "2026-10-25T20:00:00Z machine-2 offline".replace("T", " "),
    );
  });

  test("toon is a block ending in a blank line", () => {
    expect(renderEvent({ type: "presence", party: "p", online: true }, "toon")).toBe("type: presence\nparty: p\nonline: true\n");
  });
});

describe("watch against a running api", () => {
  const bus = new EventBus();
  let server: ReturnType<typeof Bun.serve>;
  let api: string;
  const tokens = new Map([["t2", "machine-2"]]);

  beforeAll(() => {
    const app = createApp({ host: "127.0.0.1", port: 0, dataPath: "/nowhere", tokens }, { bus });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
    api = `http://127.0.0.1:${server.port}/api`;
  });

  afterAll(() => {
    void server.stop(true);
  });

  test("--once returns after the first message to this machine, skipping the others", async () => {
    const out: string[] = [];
    const done = watch({ api, token: "t2", timeoutMs: 1000, source: "test", root: "/tmp/specs-bot-watch-test" }, { once: true, format: "json", types: ["chat"], to: "machine-2" }, (s) =>
      out.push(s),
    );
    await Bun.sleep(100);
    const chat = (to: string, id: string) => ({ type: "chat" as const, id, from: "maintainer", to, purpose: "rule", subject: id, at: "t" });
    bus.publish(chat("machine-1", "not-mine"));
    bus.publish(chat("machine-2", "mine"));
    expect(await done).toBe(EXIT.ok);
    expect(out.map((s) => JSON.parse(s).id)).toEqual(["mine"]);
  });

  test("--timeout gives up with exit 5", async () => {
    const code = await watch({ api, timeoutMs: 1000, source: "test", root: "/tmp/specs-bot-watch-test" }, { once: true, format: "json", types: ["write"], timeoutS: 0.2 }, () => {});
    expect(code).toBe(EXIT.timeout);
  });

  test("an unknown token is refused with exit 1", async () => {
    const code = await watch({ api, token: "nope", timeoutMs: 1000, source: "test", root: "/tmp/specs-bot-watch-test" }, { once: true, format: "json", timeoutS: 2 }, () => {});
    expect(code).toBe(EXIT.refused);
  });
});
