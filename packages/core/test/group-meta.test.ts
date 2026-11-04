import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  check,
  deriveGroupMeta,
  type GroupMeta,
  groupMetaLines,
  groupMetaProblems,
  loadStore,
  parseGroup,
  parseRetired,
  serializeGroup,
  splitGroupMeta,
  withGroupMeta,
} from "../src/index.ts";

const BODY = `# equality — \`==\` is structural

**Equality never runs user code.**

(1) Structural on every target — 210.

Steps: 210, 300
Binds: 01-checker

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 210 | 9-b · (the maintainer, 2026-09-01) | \`==\` compares by value | 01-checker · 04-js | eq_cell |
| 300 | 9-c · (the maintainer, 2026-09-02) | Overtaken by 310 | 01-checker | old_cell |
| 310 | 9-d · (the maintainer, 2026-09-03) | No user \`equals\` | 05-wasm · every repository | eq2 |
`;

const RETIRED = `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`===\` | \`==\` | 210 |  |
| \`@emit\` | \`compiler.addMember\` | 999 |  |
`;

const META: GroupMeta = {
  scope: "How `==` and `!=` are decided: structural by value on every target, no user-defined equality.",
  terms: ["`==`", "`!=`", "it's"],
  related: ["numbers-and-arithmetic"],
  binds: ["01-checker", "04-js", "05-wasm"],
  retired: ["`===`"],
  "first-step": 210,
  "last-step": 310,
  "in-force": 2,
  superseded: 1,
};

const WITH_BLOCK = [...groupMetaLines(META), ...BODY.split("\n")].join("\n");

describe("a group's metadata block", () => {
  test("a group without a block reads as before: metaEnd 0, no meta", () => {
    const g = parseGroup(BODY);
    expect([g.metaEnd, g.meta, g.slug, g.lead]).toEqual([0, undefined, "equality", "Equality never runs user code."]);
  });

  test("a block before the H1 is read with its types; the prose and rows read the same as without it", () => {
    const plain = parseGroup(BODY);
    const g = parseGroup(WITH_BLOCK, "equality");
    expect(g.meta).toEqual({ ...META });
    expect(g.lines[g.metaEnd]).toBe("# equality — `==` is structural");
    expect(g.lines[g.proseEnd]).toBe("## Record");
    expect([g.summary, g.lead, g.paragraphs, g.steps, g.binds]).toEqual([plain.summary, plain.lead, plain.paragraphs, plain.steps, plain.binds]);
    expect(g.rows.map((r) => [r.num, r.status, r.cell])).toEqual(plain.rows.map((r) => [r.num, r.status, r.cell]));
    expect(serializeGroup(g)).toBe(WITH_BLOCK);
  });

  test("the derived keys come from the rows and retired.md", () => {
    const d = deriveGroupMeta(parseGroup(BODY).rows, parseRetired(RETIRED));
    // `every repository` is prose, not a target; a superseded row's Binds do not count.
    expect(d).toEqual({ binds: ["01-checker", "04-js", "05-wasm"], retired: ["`===`"], "first-step": 210, "last-step": 310, "in-force": 2, superseded: 1 });
  });

  test("the block's lines are the migration's bytes, and survive a rewrite unchanged", () => {
    expect(groupMetaLines(META).slice(0, 4)).toEqual(["---", "scope: >-", `  ${META.scope}`, "terms:"]);
    expect(groupMetaLines(META)).toContain("  - 'it''s'");
    expect(groupMetaLines({ ...META, related: [] })).toContain("related: []");
    expect(withGroupMeta(WITH_BLOCK.split("\n"), META).join("\n")).toBe(WITH_BLOCK);
    expect(withGroupMeta(BODY.split("\n"), META).join("\n")).toBe(WITH_BLOCK);
  });

  test("shape problems: unknown keys, wrong types, an empty scope", () => {
    expect(groupMetaProblems({ ...META })).toEqual([]);
    expect(groupMetaProblems({ ...META, scope: " ", terms: "a", "in-force": "2", extra: 1 })).toEqual([
      "unknown key extra",
      "scope must be a non-empty string",
      "terms must be a list of strings",
      "in-force must be a whole number",
    ]);
  });

  test("an unreadable block is reported, not thrown, when the H1 still follows it", () => {
    expect(splitGroupMeta(["---", "scope: [", "---", "# x — y"]).error).toBeDefined();
    const g = parseGroup(["---", "scope: [", "---", BODY].join("\n"));
    expect([g.metaEnd, g.meta, typeof g.metaError]).toEqual([3, undefined, "string"]);
  });
});

function recordStore(groupText: string, related: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-group-meta-"));
  const write = (p: string, t: string) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  };
  write("specs/decisions-pending.md", "the next free\nnumber, which is **311**.\n\n## Machine 1\n\nNone open.\n");
  write("specs/retired.md", RETIRED);
  write("specs/decisions-taken/README.md", `# Decisions taken\n\n**The next free number is 311.**\n\n## Groups\n\n- equality\n${related.map((r) => `- ${r}\n`).join("")}`);
  write("specs/decisions-taken/equality.md", groupText);
  for (const r of related) write(`specs/decisions-taken/${r}.md`, `# ${r} — a neighbour\n\n## Record\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n`);
  return loadStore(root);
}

const groupFindings = (text: string, related: string[] = []) =>
  check(recordStore(text, related))
    .filter((f) => f.code.startsWith("group-"))
    .map((f) => `${f.severity} ${f.code} ${f.about}`);

describe("check — a group's metadata block", () => {
  test("a group without a block is not reported (the layout before the block)", () => {
    expect(groupFindings(BODY)).toEqual([]);
  });

  test("a current, well-formed block has no finding", () => {
    expect(groupFindings(WITH_BLOCK, ["numbers-and-arithmetic"])).toEqual([]);
  });

  test("stale derived keys, unknown or self related, and a superseded row with its old text are warnings", () => {
    const text = [
      ...groupMetaLines({ ...META, related: ["equality", "ghost"], "in-force": 9 }),
      ...BODY.replace("Overtaken by 310", "Overtaken by 310 (the later row in force, 730); the text as decided: old").split("\n"),
    ].join("\n");
    expect(groupFindings(text)).toEqual([
      "warning group-meta-stale group equality",
      "warning group-related-self group equality",
      "warning group-related-unknown group equality",
      "warning group-superseded-not-stub step 300",
    ]);
  });

  test("an unreadable block is group-meta-invalid", () => {
    expect(groupFindings(["---", "scope: [", "---", BODY].join("\n"))).toEqual(["warning group-meta-invalid group equality"]);
  });
});
