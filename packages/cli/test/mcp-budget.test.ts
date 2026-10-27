// What the MCP server costs an agent in tokens: the tool list it carries, the events after each answer.
import { describe, expect, test } from "bun:test";
import { brief, eventLine, tools, withEvents } from "../src/mcp.ts";
import { WRITES } from "../src/write.ts";

describe("brief", () => {
  test("a description is its first clause, cut at a word", () => {
    expect(brief("record a decision: the next free number, in the record; a machine's decision is marked for review", 90)).toBe(
      "record a decision: the next free number, in the record",
    );
    expect(brief("say what you are doing now — shown live on the site", 90)).toBe("say what you are doing now");
    expect(brief("a".repeat(5) + " word".repeat(40), 30)).toMatch(/…$/);
    expect(brief("a".repeat(5) + " word".repeat(40), 30).length).toBeLessThanOrEqual(30);
  });
});

describe("events after an answer", () => {
  const chat = (n: number) => ({ type: "chat", id: `m1-${n}`, from: "machine-1", to: "all", subject: `s${n}`, at: "t" }) as never;

  test("one short line each, at most ten, the rest counted", () => {
    const events = Array.from({ length: 13 }, (_, i) => chat(i));
    const out = withEvents("answer", { events, dropped: 2 });
    const lines = out.split("\n---\n")[1]!.split("\n");
    expect(lines[0]).toBe("events:");
    expect(lines.slice(1, 11)).toEqual(Array.from({ length: 10 }, (_, i) => `  chat m1-${i + 3} machine-1→all: s${i + 3}`));
    expect(lines[11]).toBe("  +5 more (wait or chat for them)");
  });

  test("a message's write is not said twice; nothing to say leaves the answer alone", () => {
    const write = { type: "write", party: "machine-1", op: "chat.send", summary: "x", at: "t" } as never;
    expect(withEvents("answer", { events: [write], dropped: 0 })).toBe("answer");
    expect(eventLine({ type: "presence", party: "machine-2", online: false, at: "t" } as never)).toBe("machine-2 offline");
  });
});

describe("the write tools", () => {
  test("each names a write of the WRITES table, and is spelled with underscores", () => {
    const writes = tools({} as never, {} as never).filter((t) => t.write);
    expect(writes.length).toBeGreaterThan(10);
    for (const t of writes) {
      expect(WRITES[t.cli!] ? t.name : `${t.name} → ${t.cli}`).toBe(t.name);
      expect(t.name).toMatch(/^[a-z_]+$/);
    }
    expect(writes.find((t) => t.name === "new_front")?.cli).toBe("new-front");
  });
});
