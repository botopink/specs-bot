import { describe, expect, test } from "bun:test";
import { parseGroup, parseRecordReadme, serializeGroup, serializeRecordReadme } from "../src/index.ts";

const MODULE_SYSTEM = `# module-system — files, modules and imports

**A file is a module.**

(1) Every \`.bp\` is a module (592 (1)).

(2) **Imports.** An import names its source (337).

Steps: 107, 337, 592
Binds: every repository · 116

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 107 | 1.0.1-beta · (the maintainer, 2026-09-01) | Every \`.bp\` is a module | every repository | mod_cell |
| 337 | 166-f · (the coordinator †, 2026-10-19) | **Imports.** An import names its source | every repository | imp_cell |
`;

describe("parseGroup", () => {
  const doc = parseGroup(MODULE_SYSTEM);

  test("reads the slug, summary and lead from the H1", () => {
    expect([doc.slug, doc.summary, doc.lead]).toEqual([
      "module-system",
      "files, modules and imports",
      "A file is a module.",
    ]);
  });

  test("reads the prose exactly as taken.ts does for a subject", () => {
    expect(doc.paragraphs).toEqual([
      "(1) Every `.bp` is a module (592 (1)).",
      "(2) **Imports.** An import names its source (337).",
    ]);
    expect(doc.steps).toEqual([107, 337, 592]);
    expect(doc.binds).toBe("every repository · 116");
  });

  test("reads the Record table's rows the same way steps.ts does", () => {
    expect(doc.rows.map((r) => [r.num, r.id, r.binds, r.cell])).toEqual([
      [107, "1.0.1-beta · (the maintainer, 2026-09-01)", "every repository", "mod_cell"],
      [337, "166-f · (the coordinator †, 2026-10-19)", "every repository", "imp_cell"],
    ]);
    expect(doc.rows.every((r) => r.section === "Record")).toBe(true);
  });

  test("proseEnd is the index of the Record heading line", () => {
    expect(doc.lines[doc.proseEnd]).toBe("## Record");
  });

  test("round-trips byte for byte", () => {
    expect(serializeGroup(doc)).toBe(MODULE_SYSTEM);
  });
});

// A paragraph that mentions "## Record" in running prose, not on a line of its own: it must not be
// mistaken for the table heading, the same guarantee taken.ts gives a `##` inside a subject's prose.
const MENTIONS_RECORD_IN_PROSE = `# unfiled — things not yet filed

**Unfiled.**

(1) This mentions ## Record in running prose, not as a heading.

Steps: 40
Binds: none

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 40 | some-id | some rule | some binds | some cell |
`;

describe("a paragraph holding `##` in running text", () => {
  const doc = parseGroup(MENTIONS_RECORD_IN_PROSE);

  test("is read as prose, not as a new heading", () => {
    expect(doc.paragraphs).toEqual(["(1) This mentions ## Record in running prose, not as a heading."]);
  });

  test("the real Record heading is still found, and its one row read", () => {
    expect(doc.lines[doc.proseEnd]).toBe("## Record");
    expect(doc.rows.map((r) => r.num)).toEqual([40]);
  });

  test("round-trips byte for byte", () => {
    expect(serializeGroup(doc)).toBe(MENTIONS_RECORD_IN_PROSE);
  });
});

// A plain group: no lead, no paragraphs, no Steps, no Binds — just the H1 and the Record table.
const UNFILED = `# unfiled — not yet grouped

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 12 | some-id | some rule | some binds | some cell |
`;

describe("a plain group with no prose", () => {
  const doc = parseGroup(UNFILED);

  test("every prose field is empty, never thrown over", () => {
    expect(doc.lead).toBe("");
    expect(doc.paragraphs).toEqual([]);
    expect(doc.steps).toEqual([]);
    expect(doc.binds).toBe("");
  });

  test("the table still reads", () => {
    expect(doc.rows.map((r) => r.num)).toEqual([12]);
  });

  test("round-trips byte for byte", () => {
    expect(serializeGroup(doc)).toBe(UNFILED);
  });
});

describe("parseGroup refusals", () => {
  test("refuses a malformed H1", () => {
    expect(() => parseGroup("# Not A Slug\n\n## Record\n")).toThrow("group heading");
  });

  test("refuses a file with no Record table", () => {
    expect(() => parseGroup("# unfiled — not yet grouped\n\nJust prose.\n")).toThrow("Record");
  });

  test("refuses a slug that does not match slugExpected, naming both", () => {
    expect(() => parseGroup(MODULE_SYSTEM, "std")).toThrow(/module-system/);
    expect(() => parseGroup(MODULE_SYSTEM, "std")).toThrow(/std/);
  });
});

const README = `# Decisions taken

The rules in force. **The next free number is 1088.**

## Groups

- module-system
- std
- unfiled
`;

describe("parseRecordReadme", () => {
  const doc = parseRecordReadme(README);

  test("reads the groups in the order written", () => {
    expect(doc.order).toEqual(["module-system", "std", "unfiled"]);
  });

  test("reads the stated next free number", () => {
    expect(doc.statedNextFree).toBe(1088);
  });

  test("round-trips byte for byte", () => {
    expect(serializeRecordReadme(doc)).toBe(README);
  });
});
