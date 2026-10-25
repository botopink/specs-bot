import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { printWrite, textArg } from "../src/write.ts";

test("text comes from a file with @, else it is the text with \\n as newlines", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "specs-bot-cli-")), "t.md");
  writeFileSync(f, "## Open\n\n- x\n");
  expect(await textArg(`@${f}`)).toBe("## Open\n\n- x\n");
  expect(await textArg("- [x] a\\n- [x] b")).toBe("- [x] a\n- [x] b");
  expect(textArg("@/nowhere/x.md")).rejects.toThrow("cannot read /nowhere/x.md");
});

test("a dry run says so and shows the diff", () => {
  const out = printWrite({ applied: false, op: "doc.append", refs: ["r#done"], summary: "", files: [], diff: "+- x" }, "toon");
  expect(out).toContain("applied: false");
  expect(out).toContain("add --apply");
  expect(out.endsWith("---\n+- x")).toBe(true);
});

test("an applied write names its commit", () => {
  expect(printWrite({ applied: true, op: "doc.append", refs: ["r#done"], summary: "", files: [], diff: "+- x", commit: "abc1234" }, "toon")).toContain("commit: abc1234");
});
