import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nextFree, parseSteps, serializeSteps, statedNextFree } from "../src/index.ts";

const SAMPLE = `# Decisions taken — the steps

The record. **The next free number is 4.**

## Language

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | 1.0.5-beta · (the maintainer, 2026-09-18) | Overtaken by 3 (the later row in force); the text | \`m-1/144\` |  |
| 3 | b1-a · (the coordinator †, 2026-10-19) · (process) | **A pipe in code: \`a | b\`** | meta | some_cell |

## Backends

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 2 | q-2 | **Replaced by 3** | \`m-2/144\` | x |
`;

describe("parseSteps", () => {
  const doc = parseSteps(SAMPLE);

  test("reads every row with its section", () => {
    expect(doc.rows.map((r) => [r.num, r.section])).toEqual([
      [1, "Language"],
      [3, "Language"],
      [2, "Backends"],
    ]);
  });

  test("anchors binds and cell when the rule holds a bare pipe", () => {
    const row = doc.rows.find((r) => r.num === 3)!;
    expect(row.rule).toBe("**A pipe in code: `a | b`**");
    expect(row.binds).toBe("meta");
    expect(row.cell).toBe("some_cell");
    expect(row.barePipe).toBe(true);
  });

  test("reads status, process and delegation", () => {
    const [one, three, two] = doc.rows;
    expect([one!.status, one!.supersededBy]).toEqual(["overtaken", 3]);
    expect([two!.status, two!.supersededBy]).toEqual(["replaced", 3]);
    expect([three!.status, three!.process, three!.delegated]).toEqual(["in-force", true, true]);
  });

  test("an empty cell is the empty string", () => {
    expect(doc.rows[0]!.cell).toBe("");
  });

  test("round-trips byte for byte", () => {
    expect(serializeSteps(doc)).toBe(SAMPLE);
  });

  test("the next free number is one past the highest, and the head states it", () => {
    expect(nextFree(doc)).toBe(4);
    expect(doc.statedNextFree).toBe(4);
  });
});

describe("statedNextFree", () => {
  test("reads the pending file's wording across a line break", () => {
    expect(statedNextFree("holds the answers and the next free\nnumber, which is **957**. ")).toBe(957);
  });

  test("is undefined when the text names none", () => {
    expect(statedNextFree("no number here")).toBeUndefined();
  });
});

// Against the real record when the data repository is on this machine (SPECS_DATA_PATH, as the server reads it).
const real = join(process.env.SPECS_DATA_PATH ?? "", "specs/decisions-taken-steps.md");

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!process.env.SPECS_DATA_PATH || !existsSync(real))) describe("the real decisions-taken-steps.md", () => {
  const text = readFileSync(real, "utf8");
  const doc = parseSteps(text);

  test("round-trips byte for byte", () => {
    expect(serializeSteps(doc)).toBe(text);
  });

  test("every number is unique", () => {
    const nums = doc.rows.map((r) => r.num);
    expect(new Set(nums).size).toBe(nums.length);
  });

  test("the stated next free number matches the rows", () => {
    expect(doc.statedNextFree).toBe(nextFree(doc));
  });

  test("every row has a non-empty id and rule", () => {
    expect(doc.rows.filter((r) => !r.id || !r.rule).map((r) => r.num)).toEqual([]);
  });
});
