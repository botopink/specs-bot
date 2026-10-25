import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePending, parseSteps, pendingEntries, serializePending, statedNextFree } from "../src/index.ts";

const SAMPLE = `# Decisions the maintainer owes

Answered ids leave this file; the next free
number, which is **12**.

## To review — the fable's decisions

| Reviewed | Row | Answered | What was decided |
|---|---|---|---|
| [ ] | 10 | 9-a | Answered by the maintainer: a rule |
| [x] | 11 | 9-b | Another, with \`a | b\` in it |

## Machine 1 — maximum priority

None open.

#### 9-c · Do \`!(v is A)\` narrow \`v\`? (decision 9)

- **Measured.** First line
  continued here.
- **Options.** (a) yes; (b) no.
- **Recommendation.** (a).
- **Blocks.** Nothing; built as (a).

#### b1-place · One value run twice
- **Measured.** Built.

## Part 3 — Implementation choices

None open.
`;

describe("parsePending", () => {
  const doc = parsePending(SAMPLE);

  test("reads the sections in order", () => {
    expect(doc.sections.map((s) => s.heading)).toEqual([
      "To review — the fable's decisions",
      "Machine 1 — maximum priority",
      "Part 3 — Implementation choices",
    ]);
  });

  test("reads each entry's id, title and section", () => {
    expect(pendingEntries(doc).map((e) => [e.id, e.title, e.section])).toEqual([
      ["9-c", "Do `!(v is A)` narrow `v`? (decision 9)", "Machine 1 — maximum priority"],
      ["b1-place", "One value run twice", "Machine 1 — maximum priority"],
    ]);
  });

  test("reads the fields, continuation lines joined", () => {
    const [first] = pendingEntries(doc);
    expect(first!.fields).toEqual([
      { name: "Measured", text: "First line\ncontinued here." },
      { name: "Options", text: "(a) yes; (b) no." },
      { name: "Recommendation", text: "(a)." },
      { name: "Blocks", text: "Nothing; built as (a)." },
    ]);
  });

  test("reads the review table", () => {
    expect(doc.review.map((r) => [r.reviewed, r.step, r.answered, r.summary])).toEqual([
      [false, 10, "9-a", "Answered by the maintainer: a rule"],
      [true, 11, "9-b", "Another, with `a | b` in it"],
    ]);
  });

  test("rebuilds the file from its regions byte for byte", () => {
    expect(serializePending(doc)).toBe(SAMPLE);
  });

  test("states the next free number", () => {
    expect(statedNextFree(SAMPLE)).toBe(12);
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
const en = join(root, "specs/decisions-pending.md");
const pt = join(root, "specs/decisoes-pendentes.md");
const steps = join(root, "specs/decisions-taken-steps.md");

describe.skipIf(!root || !existsSync(en))("the real pending files", () => {
  const enText = readFileSync(en, "utf8");
  const enDoc = parsePending(enText);
  const stepsDoc = parseSteps(readFileSync(steps, "utf8"));

  test("decisions-pending.md rebuilds byte for byte", () => {
    expect(serializePending(enDoc)).toBe(enText);
  });

  test("decisoes-pendentes.md rebuilds byte for byte", () => {
    const ptText = readFileSync(pt, "utf8");
    expect(serializePending(parsePending(ptText))).toBe(ptText);
  });

  test("every entry has a unique id and at least one field", () => {
    const entries = pendingEntries(enDoc);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(entries.filter((e) => e.fields.length === 0).map((e) => e.id)).toEqual([]);
  });

  test("states the same next free number as the steps record", () => {
    expect(statedNextFree(enText)).toBe(stepsDoc.statedNextFree);
  });

  test("every review row names a step that exists", () => {
    const nums = new Set(stepsDoc.rows.map((r) => r.num));
    expect(enDoc.review.filter((r) => !nums.has(r.step)).map((r) => r.step)).toEqual([]);
  });
});
