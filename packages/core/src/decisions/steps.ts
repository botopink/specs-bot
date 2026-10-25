// decisions-taken-steps.md — the record, one table row per decision: `| # | Id | Rule in force | Binds | Cell |`.
// The rows are grouped under `##` subject headings, so the numbers are not in file order.
import { joinRow, splitRow } from "../md/table.ts";

export type StepStatus = "in-force" | "overtaken" | "replaced" | "reversed";

export interface StepRow {
  num: number;
  /** The Id cell as written: "166-f · (the coordinator †, 2026-10-19)". */
  id: string;
  rule: string;
  binds: string;
  cell: string;
  /** The `##` heading the row sits under. */
  section: string;
  status: StepStatus;
  supersededBy?: number;
  process: boolean;
  /** † — decided under the maintainer's delegation, reversible by him. */
  delegated: boolean;
  /** The rule cell holds a bare `|` and renders broken on GitHub. */
  barePipe: boolean;
  /** Index of the row's line in `StepsDoc.lines`. */
  line: number;
  /** The cells as written, spaces kept, for the byte-exact round trip. */
  raw: { num: string; id: string; rule: string; binds: string; cell: string };
}

export interface StepsDoc {
  lines: string[];
  rows: StepRow[];
  /** The next free number as the file's head states it. */
  statedNextFree?: number;
}

const ROW = /^\| (\d+) \|/;
const STATUS = /^\s*\**(Overtaken|Replaced|Reversed) by (\d+)/;

export function parseSteps(text: string): StepsDoc {
  const lines = text.split("\n");
  const rows: StepRow[] = [];
  let section = "";
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      section = line.slice(3);
      return;
    }
    if (ROW.test(line)) rows.push(parseRow(line, i, section));
  });
  const next = statedNextFree(text);
  return { lines, rows, ...(next !== undefined ? { statedNextFree: next } : {}) };
}

function parseRow(line: string, index: number, section: string): StepRow {
  const cells = splitRow(line);
  if (cells.length < 5) throw new Error(`step row on line ${index + 1} has ${cells.length} cells`);
  // Anchored: number and id first, binds and cell last; a bare `|` can only be inside the rule.
  const [num, id] = cells as [string, string];
  const binds = cells[cells.length - 2]!;
  const cell = cells[cells.length - 1]!;
  const rule = cells.slice(2, -2).join("|");
  const status = rule.match(STATUS);
  return {
    num: Number(num.trim()),
    id: id.trim(),
    rule: rule.trim(),
    binds: binds.trim(),
    cell: cell.trim(),
    section,
    status: status ? (status[1]!.toLowerCase() as StepStatus) : "in-force",
    ...(status ? { supersededBy: Number(status[2]) } : {}),
    process: id.includes("(process)"),
    delegated: id.includes("†"),
    barePipe: cells.length > 5,
    line: index,
    raw: { num, id, rule, binds, cell },
  };
}

/** The row's line, from its raw cells. */
export function formatStepRow(row: Pick<StepRow, "raw">): string {
  const { num, id, rule, binds, cell } = row.raw;
  return joinRow([num, id, rule, binds, cell]);
}

export function serializeSteps(doc: StepsDoc): string {
  const lines = [...doc.lines];
  for (const row of doc.rows) lines[row.line] = formatStepRow(row);
  return lines.join("\n");
}

/**
 * The number a file's text names as the next free one: "**The next free number is 957.**" (steps),
 * "the next free\nnumber, which is **957**" (pending). Undefined when the text names none.
 */
export function statedNextFree(text: string): number | undefined {
  const m = text.match(/next free\s+number,?\s+(?:which\s+)?is\s+\**(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** One past the highest number used; numbers are never reused, gaps included. */
export function nextFree(doc: StepsDoc): number {
  return doc.rows.reduce((max, r) => Math.max(max, r.num), 0) + 1;
}
