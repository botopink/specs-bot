// decisions-pending.md — the open questions: a head, `##` sections, and in them `#### <id> · <title>` blocks whose
// body is `- **Measured.** …` style fields. The "To review" section holds a table instead:
// `| [ ] | 814 | <answered> | <what was decided> |`. decisoes-pendentes.md has the same shape and is parsed alike.
import { isRow, splitRow } from "../md/table.ts";

export interface PendingField {
  /** "Measured", "Options", "Recommendation", "Blocks", … as written, without the bold and the dot. */
  name: string;
  /** The field's text, continuation lines joined with "\n" and their indentation removed. */
  text: string;
}

export interface PendingEntry {
  id: string;
  title: string;
  section: string;
  fields: PendingField[];
  /** The block's lines, the `####` heading first; up to the next `####` or `##`. */
  lines: string[];
  /** Index of the heading line in `PendingDoc.lines`. */
  line: number;
}

export interface ReviewItem {
  reviewed: boolean;
  step: number;
  answered: string;
  summary: string;
  line: number;
}

export interface PendingSection {
  heading: string;
  line: number;
  /** The lines between the heading and the first entry (or the next section). */
  intro: string[];
  entries: PendingEntry[];
}

export interface PendingDoc {
  lines: string[];
  head: string[];
  sections: PendingSection[];
  review: ReviewItem[];
}

const ENTRY = /^#### (.+?) · (.+)$/;
const FIELD = /^- \*\*([^*]+?)\.\*\* ?(.*)$/;

export function parsePending(text: string): PendingDoc {
  const lines = text.split("\n");
  const head: string[] = [];
  const sections: PendingSection[] = [];
  let section: PendingSection | undefined;
  let entry: PendingEntry | undefined;

  lines.forEach((line, i) => {
    if (line.startsWith("## ")) {
      entry = undefined;
      section = { heading: line.slice(3), line: i, intro: [], entries: [] };
      sections.push(section);
      return;
    }
    const m = line.match(ENTRY);
    if (m && section) {
      entry = { id: m[1]!, title: m[2]!, section: section.heading, fields: [], lines: [line], line: i };
      section.entries.push(entry);
      return;
    }
    if (entry) entry.lines.push(line);
    else if (section) section.intro.push(line);
    else head.push(line);
  });

  for (const s of sections) for (const e of s.entries) e.fields = parseFields(e.lines.slice(1));
  return { lines, head, sections, review: parseReview(lines) };
}

function parseFields(body: string[]): PendingField[] {
  const fields: PendingField[] = [];
  let current: PendingField | undefined;
  for (const line of body) {
    const m = line.match(FIELD);
    if (m) {
      current = { name: m[1]!, text: m[2]! };
      fields.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += "\n" + line.trimStart();
    } else {
      current = undefined;
    }
  }
  return fields;
}

const REVIEW_ROW = /^\| \[( |x)\] \| \d+ \|/;

function parseReview(lines: string[]): ReviewItem[] {
  const items: ReviewItem[] = [];
  lines.forEach((line, i) => {
    if (!isRow(line) || !REVIEW_ROW.test(line)) return;
    const cells = splitRow(line);
    items.push({
      reviewed: cells[0]!.trim() === "[x]",
      step: Number(cells[1]),
      answered: cells[2]!.trim(),
      // The last cell may hold a bare `|`; rejoin before trimming so its spaces survive.
      summary: cells.slice(3).join("|").trim(),
      line: i,
    });
  });
  return items;
}

/** Rebuilt from the regions alone — head, then each section's heading, intro and entries. */
export function serializePending(doc: PendingDoc): string {
  const out = [...doc.head];
  for (const s of doc.sections) {
    out.push(`## ${s.heading}`, ...s.intro);
    for (const e of s.entries) out.push(...e.lines);
  }
  return out.join("\n");
}

export function pendingEntries(doc: PendingDoc): PendingEntry[] {
  return doc.sections.flatMap((s) => s.entries);
}
