import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNumberList, parseSteps, parseTaken, serializeTaken } from "../src/index.ts";

const SAMPLE = `# Decisions taken

The rules in force.

## module-system — files, modules and imports

**A file is a module.**

(1) Every \`.bp\` is a module (592 (1)).

(2) **Imports.** An import names its source (337).

Steps: 107, 337, 592
Binds: every repository · 116

---

## std — the standard library's surface

**What std holds.**

Steps: 115
Binds: std
`;

describe("parseTaken", () => {
  const doc = parseTaken(SAMPLE);

  test("reads each subject's slug, summary and lead", () => {
    expect(doc.subjects.map((s) => [s.slug, s.summary, s.lead])).toEqual([
      ["module-system", "files, modules and imports", "A file is a module."],
      ["std", "the standard library's surface", "What std holds."],
    ]);
  });

  test("reads Steps and Binds glued to the paragraph above", () => {
    const glued = parseTaken("## a — b\n\n**Lead.**\n\nText.\nSteps: 1, 2\nBinds: x\n");
    expect(glued.subjects[0]!.paragraphs).toEqual(["Text."]);
    expect(glued.subjects[0]!.steps).toEqual([1, 2]);
    expect(glued.subjects[0]!.binds).toBe("x");
  });

  test("reads paragraphs, steps and binds; a rule line is not a paragraph", () => {
    const [ms] = doc.subjects;
    expect(ms!.paragraphs).toEqual([
      "(1) Every `.bp` is a module (592 (1)).",
      "(2) **Imports.** An import names its source (337).",
    ]);
    expect(ms!.steps).toEqual([107, 337, 592]);
    expect(ms!.binds).toBe("every repository · 116");
  });

  test("rebuilds the file byte for byte", () => {
    expect(serializeTaken(doc)).toBe(SAMPLE);
  });

  test("refuses a malformed heading", () => {
    expect(() => parseTaken("## Not A Slug\n")).toThrow("subject heading");
  });
});

describe("parseNumberList", () => {
  test("refuses a token that is not a number", () => {
    expect(() => parseNumberList("1, 2a, 3")).toThrow("2a");
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
const taken = join(root, "specs/decisions-taken.md");

describe.skipIf(!root || !existsSync(taken))("the real decisions-taken.md", () => {
  const text = readFileSync(taken, "utf8");
  const doc = parseTaken(text);
  const steps = parseSteps(readFileSync(join(root, "specs/decisions-taken-steps.md"), "utf8"));

  test("rebuilds byte for byte", () => {
    expect(serializeTaken(doc)).toBe(text);
  });

  test("every subject has paragraphs, steps and binds", () => {
    const incomplete = doc.subjects.filter((s) => !s.paragraphs.length || !s.steps.length || !s.binds);
    expect(incomplete.map((s) => s.slug)).toEqual([]);
  });

  test("a subject without a bold lead is a known finding", () => {
    // Reported by check; the list pins today's data so a new one is noticed.
    expect(doc.subjects.filter((s) => !s.lead).map((s) => s.slug)).toEqual(["contexts-and-components", "rakun-ssr"]);
  });

  test("slugs are unique", () => {
    expect(new Set(doc.subjects.map((s) => s.slug)).size).toBe(doc.subjects.length);
  });

  test("every step a subject cites exists in the record", () => {
    const nums = new Set(steps.rows.map((r) => r.num));
    const missing = doc.subjects.flatMap((s) => s.steps.filter((n) => !nums.has(n)).map((n) => `${s.slug}:${n}`));
    expect(missing).toEqual([]);
  });
});
