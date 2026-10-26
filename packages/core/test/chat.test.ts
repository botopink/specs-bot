import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadChat, parseMessage, parseRead, replyIds, serializeMessage, unreadBy } from "../src/index.ts";

const MSG = `---
from: machine-1
to: maintainer
purpose: report
subject: Status after 660 — what landed: a, b
read: [x]
in-reply-to: machine-1/20261018-1627-answers-667-668-b152-mt-0002.md
---

Done:
- 612–616 applied.
`;

describe("parseMessage", () => {
  const m = parseMessage("machine-1/20261018-1712-status-after-660-m1-0002.md", MSG);

  test("reads the file name", () => {
    expect([m.ref, m.dir, m.id, m.at, m.slug]).toEqual([
      "machine-1/20261018-1712-status-after-660-m1-0002",
      "machine-1",
      "m1-0002",
      "2026-10-18T17:12",
      "status-after-660",
    ]);
  });

  test("reads the head; a colon in the subject stays", () => {
    expect([m.from, m.to, m.purpose, m.subject, m.inReplyTo]).toEqual([
      "machine-1",
      "maintainer",
      "report",
      "Status after 660 — what landed: a, b",
      "machine-1/20261018-1627-answers-667-668-b152-mt-0002.md",
    ]);
    expect(m.read).toEqual({ maintainer: true });
    expect(m.replyTo).toEqual(["mt-0002"]);
  });

  test("the body starts after the head", () => {
    expect(m.body).toBe("Done:\n- 612–616 applied.\n");
  });

  test("round-trips byte for byte", () => {
    expect(serializeMessage(m)).toBe(MSG);
  });

  test("refuses a file name out of the convention", () => {
    expect(() => parseMessage("machine-1/notes.md", MSG)).toThrow("not a message path");
  });

  test("refuses a head without its fields", () => {
    expect(() => parseMessage("all/20261018-1712-x-mt-0001.md", "---\nfrom: maintainer\n---\n")).toThrow("lacks to");
  });
});

describe("parseRead", () => {
  test("a message to all has one mark per machine", () => {
    expect(parseRead("m1 [x] · m2 [ ]", "all")).toEqual({ "machine-1": true, "machine-2": false });
  });

  test("an old mark of a party that never was (m3) is dropped", () => {
    expect(parseRead("m1 [x] · m2 [x] · m3 [ ]", "all")).toEqual({ "machine-1": true, "machine-2": true });
  });
});

describe("replyIds", () => {
  test("reads the id from a path, a bare name or a list", () => {
    expect(replyIds("machine-1/20261019-0333-held-m1-0004.md, 20261019-0400-y-m2-0001.md")).toEqual(["m1-0004", "m2-0001"]);
  });
});

describe("unreadBy", () => {
  test("lists what a party has not read", () => {
    const a = parseMessage("all/20261020-1000-rule-mt-0001.md", MSG.replace("read: [x]", "read: m1 [x] · m2 [ ]").replace("to: maintainer", "to: all"));
    const b = parseMessage("machine-2/20261020-1100-ask-m1-0003.md", MSG.replace("read: [x]", "read: [ ]").replace("to: maintainer", "to: machine-2"));
    expect(unreadBy([a, b], "machine-2").map((m) => m.id)).toEqual(["mt-0001", "m1-0003"]);
    expect(unreadBy([a, b], "machine-1")).toEqual([]);
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
const chat = join(root, "conversation-chat");

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!root || !existsSync(chat))) describe("the real conversation", () => {
  const messages = loadChat(chat);

  test("reads every message", () => {
    expect(messages.length).toBeGreaterThanOrEqual(118);
  });

  test("every message round-trips byte for byte", () => {
    const off = messages.filter((m) => serializeMessage(m) !== readFileSync(join(chat, `${m.ref}.md`), "utf8"));
    expect(off.map((m) => m.ref)).toEqual([]);
  });

  test("ids are unique", () => {
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
  });

  test("every reply resolves by id to a message that exists", () => {
    const ids = new Set(messages.map((m) => m.id));
    expect(messages.filter((m) => m.inReplyTo && m.replyTo.length === 0).map((m) => m.ref)).toEqual([]);
    expect(messages.flatMap((m) => m.replyTo.filter((id) => !ids.has(id)))).toEqual([]);
  });
});
