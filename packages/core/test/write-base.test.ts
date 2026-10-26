import { describe, expect, test } from "bun:test";
import { addedLines, etagOf, textRules, unifiedDiff, WriteError } from "../src/index.ts";

describe("unifiedDiff", () => {
  test("shows one region with its context", () => {
    const d = unifiedDiff("specs/x.md", "a\nb\nc\nd\ne\n", "a\nb\nC\nd\ne\n", 1);
    expect(d).toBe("--- a/specs/x.md\n+++ b/specs/x.md\n@@ -2,3 +2,3 @@\n b\n-c\n+C\n d");
  });

  test("a new file comes from /dev/null", () => {
    expect(unifiedDiff("specs/n.md", null, "# N\n").split("\n").slice(0, 3)).toEqual(["--- /dev/null", "+++ b/specs/n.md", "@@ -0,0 +1,2 @@"]);
  });

  test("no change, no diff", () => {
    expect(unifiedDiff("x", "a\n", "a\n")).toBe("");
  });
});

describe("addedLines", () => {
  test("are the lines between the common head and tail", () => {
    expect(addedLines("a\nb\nc", "a\nX\nY\nc")).toEqual(["X", "Y"]);
  });
});

describe("textRules", () => {
  test("a line rewritten in place keeps its old hashes and paths; a new one is still refused", () => {
    const row = "| 54 | rule | see [the fix](https://github.com/o/r/commit/1a2b3c4d5e) and /tmp/x |";
    const was = { op: "supersede", refs: [], message: "m", summary: "s", changes: [{ path: "specs/decisions-taken-steps.md", before: `# R\n${row}\n`, after: `# R\n${row.replace("rule", "Overtaken by 980; rule")}\n` }] };
    expect(textRules(was)).toEqual([]);
    const more = { ...was, changes: [{ ...was.changes[0]!, after: `# R\n${row.replace("rule", "rule 9f8e7d6c")}\n` }] };
    expect(textRules(more).map((f) => [f.rule, f.match])).toEqual([["commit-hash", "9f8e7d6c"]]);
    // A path already elsewhere in the file is no excuse for a new line.
    const elsewhere = { ...was, changes: [{ path: "specs/x.md", before: "a /tmp/y\n", after: "a /tmp/y\nb /tmp/z\n" }] };
    expect(textRules(elsewhere).map((f) => f.rule)).toEqual(["tmp-path"]);
  });

  const plan = (after: string, path = "specs/milestone/status.md") => ({
    op: "doc.replace",
    refs: [],
    message: "",
    summary: "",
    changes: [{ path, before: "x\n", after: `x\n${after}\n` }],
  });

  test("a commit hash in an added spec line is refused", () => {
    expect(textRules(plan("landed in 1a2b3c4d")).map((f) => f.rule)).toEqual(["commit-hash"]);
  });

  test("scratch paths and task branches are refused", () => {
    expect(textRules(plan("see .tasks/foo-1/patch and /tmp/x on front/b162-p1 in worktree `w1`")).map((f) => f.rule)).toEqual([
      "tasks-path",
      "tmp-path",
      "task-branch",
      "worktree",
    ]);
  });

  test("words that only look like hex, placeholders and other folders pass", () => {
    expect(textRules(plan("decade facade 1234567 abcdefa front/<name> `.tasks/<task>`"))).toEqual([]);
    expect(textRules(plan("1a2b3c4d", "conversation-chat/machine-2/x.md"))).toEqual([]);
  });
});

test("a write error knows its HTTP status", () => {
  expect([new WriteError("conflict", "x").status, new WriteError("invalid", "x").status, new WriteError("frozen", "x").status]).toEqual([409, 422, 423]);
});

test("an etag is a short stable hash", () => {
  expect(etagOf("abc")).toBe(etagOf("abc"));
  expect(etagOf("abc")).not.toBe(etagOf("abd"));
  expect(etagOf("abc")).toHaveLength(12);
});

describe("two far changes", () => {
  const before = ["head 5", ...Array.from({ length: 40 }, (_, i) => `row ${i} 1a2b3c4d`), "last"].join("\n");
  const after = before.replace("head 5", "head 6").replace("\nlast", "\nnew row\nlast");

  test("add only their own lines", () => {
    expect(addedLines(before, after)).toEqual(["head 6", "new row"]);
  });

  test("show two hunks", () => {
    expect(unifiedDiff("f", before, after, 1).match(/^@@/gm)).toHaveLength(2);
  });
});
