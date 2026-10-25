import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRetired, parseSteps, serializeRetired, stepNumbers } from "../src/index.ts";

const SAMPLE = `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`@Result<T, E>\` | \`Result<T, E>\` | 606 (1), 609 | 2026-10-18 |
| \`@Task<T>\` | \`Async<T>\` | 553 (2), 732 |  |

## How to use this page

Text, not a table.
`;

describe("parseRetired", () => {
  const doc = parseRetired(SAMPLE);

  test("reads each row with its area", () => {
    expect(doc.rows.map((r) => [r.area, r.retired, r.replacedBy, r.decisions, r.note])).toEqual([
      ["Language spellings", "`@Result<T, E>`", "`Result<T, E>`", "606 (1), 609", "2026-10-18"],
      ["Language spellings", "`@Task<T>`", "`Async<T>`", "553 (2), 732", ""],
    ]);
  });

  test("rebuilds byte for byte", () => {
    expect(serializeRetired(doc)).toBe(SAMPLE);
  });
});

describe("stepNumbers", () => {
  test("drops the parenthesised part numbers", () => {
    expect(stepNumbers("606 (1), 609, 606 (2)")).toEqual([606, 609]);
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
const file = join(root, "specs/retired.md");

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!root || !existsSync(file))) describe("the real retired.md", () => {
  const text = readFileSync(file, "utf8");
  const doc = parseRetired(text);

  test("rebuilds byte for byte", () => {
    expect(serializeRetired(doc)).toBe(text);
  });

  test("reads all 312 rows across the areas", () => {
    expect(doc.rows.length).toBeGreaterThanOrEqual(312);
  });

  test("every row names a retired form and its source", () => {
    // The source is usually step numbers; a few rows cite the maintainer or `AGENTS.md` instead.
    expect(doc.rows.filter((r) => !r.retired || !r.decisions).map((r) => r.line + 1)).toEqual([]);
  });

  test("the decisions it cites exist in the record", () => {
    const nums = new Set(parseSteps(readFileSync(join(root, "specs/decisions-taken-steps.md"), "utf8")).rows.map((r) => r.num));
    const missing = [...new Set(doc.rows.flatMap((r) => r.steps.filter((n) => !nums.has(n))))].sort((a, b) => a - b);
    expect(missing).toEqual([]);
  });
});
