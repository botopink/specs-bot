// retired.md — every retired form and its replacement, one `## <area>` table each:
// `| Retired | Replaced by | Decisions | Since / note |`.
import { isRow, joinRow, splitRow } from "../md/table.ts";

export interface RetiredRow {
  area: string;
  retired: string;
  replacedBy: string;
  /** The Decisions cell as written: "606 (1), 609". */
  decisions: string;
  /** The step numbers the Decisions cell names, in order, without repeats. */
  steps: number[];
  note: string;
  line: number;
  raw: string[];
}

export interface RetiredDoc {
  lines: string[];
  rows: RetiredRow[];
}

const HEADER = "| Retired | Replaced by | Decisions | Since / note |";

export function parseRetired(text: string): RetiredDoc {
  const lines = text.split("\n");
  const rows: RetiredRow[] = [];
  let area = "";
  let inTable = false;
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      area = line.slice(3);
      inTable = false;
    } else if (line === HEADER) {
      inTable = true;
    } else if (inTable && isRow(line) && !line.startsWith("|---")) {
      const raw = splitRow(line);
      if (raw.length !== 4) throw new Error(`retired.md line ${i + 1}: ${raw.length} cells, 4 expected`);
      const [retired, replacedBy, decisions, note] = raw.map((c) => c.trim()) as [string, string, string, string];
      rows.push({ area, retired, replacedBy, decisions, steps: stepNumbers(decisions), note, line: i, raw });
    } else if (!isRow(line)) {
      inTable = false;
    }
  });
  return { lines, rows };
}

/** "606 (1), 609, 118–128" → [606, 609, 118]; a parenthesised part number is not a step. */
export function stepNumbers(cell: string): number[] {
  const seen = new Set<number>();
  for (const m of cell.replace(/\([^)]*\)/g, "").matchAll(/\b\d+\b/g)) seen.add(Number(m[0]));
  return [...seen];
}

export function serializeRetired(doc: RetiredDoc): string {
  const lines = [...doc.lines];
  for (const row of doc.rows) lines[row.line] = joinRow(row.raw);
  return lines.join("\n");
}
