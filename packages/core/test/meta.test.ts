import { describe, expect, test } from "bun:test";
import { metaKey, metaLines, parseDoc, splitMeta, withMeta } from "../src/index.ts";

const roundTrip = (meta: Record<string, string>) => splitMeta(metaLines(meta)).meta;

describe("metadata block", () => {
  test("milestone and owner come first, then the keys in their order", () => {
    expect(metaLines({ priority: "high", owner: "machine-1", milestone: "1.0.12-beta" })).toEqual([
      "---",
      "milestone: 1.0.12-beta",
      "owner: machine-1",
      "priority: high",
      "---",
    ]);
  });

  test("a value of several lines is a literal block and reads back whole", () => {
    const meta = { milestone: "1.0.12-beta", "does-not-touch": "`repository/botopink-lang/**` — a gap\nfront pauses: rules 1, 9\n\nafter a blank line" };
    const lines = metaLines(meta);
    expect(lines).toContain("does-not-touch: |-");
    expect(lines).toContain("  front pauses: rules 1, 9");
    expect(roundTrip(meta)).toEqual(meta);
  });

  test("a value whose first line starts with spaces keeps them", () => {
    const meta = { milestone: "1", code: "  indented\nnext" };
    expect(metaLines(meta)).toContain("code: |2-");
    expect(roundTrip(meta)).toEqual(meta);
  });

  test("values YAML would read as numbers, booleans or null stay strings", () => {
    const meta = { milestone: "1.0", wave: "3", done: "yes", flag: "true", none: "null", stamp: "2026-10-26", colon: "a: b", hash: "x #y", quote: '"q"' };
    expect(roundTrip(meta)).toEqual(meta);
  });

  test("markdown with backticks, links and bold reads back as written", () => {
    const meta = { milestone: "1.0.12-beta", owns: "`repository/rakun/**` (see [04](04-rakun/README.md) § **Groups**)" };
    expect(roundTrip(meta)).toEqual(meta);
  });

  test("keys are the labels in lower case with hyphens; Machine is owner", () => {
    expect(metaKey("Depends on")).toBe("depends-on");
    expect(metaKey("Machine")).toBe("owner");
    expect(metaKey("Owns (still)")).toBe("owns-still");
    expect(metaKey("Pendências")).toBe("pendências");
  });

  test("a document without a block has none; a broken one says why", () => {
    expect(splitMeta(["# Title"])).toEqual({ meta: {}, end: 0 });
    expect(splitMeta(["---", "a: 1", "# no end"]).error).toContain("closing");
    expect(splitMeta(["---", "a: [", "---"]).error).toBeDefined();
    expect(splitMeta(["---", "- a", "---"]).error).toContain("mapping");
  });

  test("withMeta replaces the block and leaves the body", () => {
    const lines = ["---", "milestone: 1.0.12-beta", "---", "# T", "", "body"];
    expect(withMeta(lines, { milestone: "1.0.12-beta", owner: "machine-2" })).toEqual(["---", "milestone: 1.0.12-beta", "owner: machine-2", "---", "# T", "", "body"]);
    expect(withMeta(["# T"], { milestone: "1.0.12-beta" })).toEqual(["---", "milestone: 1.0.12-beta", "---", "# T"]);
    // A number-like value is written quoted, so it reads back a string.
    expect(withMeta(["# T"], { milestone: "1" })).toEqual(["---", 'milestone: "1"', "---", "# T"]);
  });

  test("a parsed document reads its block: milestone, owner; sections and title follow the block", () => {
    const d = parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\nwave: \"3\"\n---\n# Front 150\n\n## Steps\n");
    expect(d.meta).toEqual({ milestone: "1.0.12-beta", owner: "machine-1", wave: "3" });
    expect(d.fields).toEqual({ milestone: "1.0.12-beta", machine: "machine-1" });
    expect(d.title).toBe("Front 150");
    expect(d.sections.map((s) => [s.heading, s.start])).toEqual([["Front 150", 5], ["Steps", 7]]);
  });

  test("a sample under examples/ keeps its block as content: it is no metadata", () => {
    const d = parseDoc("150-rakun/examples/post.md", "---\ntitle: Post\nmilestone: 9\n---\n# Post\n");
    expect(d.meta).toEqual({});
    expect(d.fields).toEqual({});
  });
});
