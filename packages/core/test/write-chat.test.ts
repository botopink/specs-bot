import { describe, expect, test } from "bun:test";
import {
  buildModel,
  chatRead,
  chatSend,
  type Model,
  parseMessage,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  slugOf,
  WriteError,
} from "../src/index.ts";

const msg = (path: string, head: string) => parseMessage(path, `---\n${head}\nin-reply-to:\n---\n\nBody.\n`);

const model: Model = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(""),
  pending: parsePending(""),
  taken: parseTaken(""),
  retired: parseRetired(""),
  tree: { docs: [], versions: [], current: "" },
  chat: [
    msg("machine-2/20261021-1144-rebased-m1-0024.md", "from: machine-1\nto: machine-2\npurpose: report\nsubject: Rebased\nread: [ ]"),
    msg("all/20261020-1152-a-rule-mt-0035.md", "from: maintainer\nto: all\npurpose: rule\nsubject: A rule\nread: m1 [x] · m2 [ ] · m3 [ ]"),
  ],
});

const AT = new Date(2026, 9, 25, 9, 5);
const file = (p: { changes: { path: string; after: string }[] }) => p.changes[0]!;

function refused(fn: () => unknown): WriteError {
  try {
    fn();
  } catch (e) {
    if (e instanceof WriteError) return e;
    throw e;
  }
  throw new Error("not refused");
}

describe("chatSend", () => {
  test("a machine's answer to the maintainer is filed in its own conversation, with its next number", () => {
    const p = chatSend(model, { to: "maintainer", purpose: "answer", subject: "B-162 — landed; next: P2", text: "Done:\n- a", inReplyTo: "m1-0024", at: AT }, "machine-1");
    expect(file(p).path).toBe("conversation-chat/machine-1/20261025-0905-b-162-landed-next-p2-m1-0025.md");
    const back = parseMessage(file(p).path.replace("conversation-chat/", ""), file(p).after);
    expect([back.from, back.to, back.purpose, back.read, back.replyTo, back.body]).toEqual([
      "machine-1",
      "maintainer",
      "answer",
      { maintainer: false },
      ["m1-0024"],
      "Done:\n- a\n",
    ]);
    expect(p.chat).toEqual({ id: "m1-0025", from: "machine-1", to: "maintainer", purpose: "answer", subject: "B-162 — landed; next: P2" });
  });

  test("the maintainer to all: one mark per machine", () => {
    const p = chatSend(model, { to: "all", purpose: "rule", subject: "Another rule", text: "x", at: AT }, "maintainer");
    expect(file(p).path).toBe("conversation-chat/all/20261025-0905-another-rule-mt-0036.md");
    expect(file(p).after).toContain("read: m1 [ ] · m2 [ ] · m3 [ ]\n");
  });

  test("refuses a purpose, a party or an answer that does not exist", () => {
    expect(refused(() => chatSend(model, { to: "maintainer", purpose: "chat", subject: "x", text: "x" }, "machine-1")).message).toContain("purpose is one of");
    expect(refused(() => chatSend(model, { to: "machine-9", purpose: "report", subject: "x", text: "x" }, "machine-1")).message).toContain("to is one of");
    expect(refused(() => chatSend(model, { to: "maintainer", purpose: "answer", subject: "x", text: "x", inReplyTo: "m9-0001" }, "machine-1")).code).toBe("not-found");
  });
});

describe("chatRead", () => {
  test("the addressee's mark turns to [x]", () => {
    expect(file(chatRead(model, { id: "m1-0024" }, "machine-2")).after).toContain("read: [x]\n");
    expect(file(chatRead(model, { id: "mt-0035" }, "machine-2")).after).toContain("read: m1 [x] · m2 [x] · m3 [ ]\n");
  });

  test("only the addressee, and only once", () => {
    expect(refused(() => chatRead(model, { id: "m1-0024" }, "machine-3")).code).toBe("forbidden");
    expect(refused(() => chatRead(model, { id: "mt-0035" }, "machine-1")).message).toContain("already read");
  });
});

test("slugOf keeps up to six plain words", () => {
  expect(slugOf("Status após 660, 661 — o que entrou e o que bloqueia")).toBe("status-apos-660-661-o-que");
});
