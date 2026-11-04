// A group — `# <slug> — <summary>` file combining a `taken.ts` subject's prose with a `steps.ts` record
// table under its own `## Record` heading, the two formats of one subject side by side in one document
// instead of split across `decisions-taken.md` and `decisions-taken-steps.md`. The file may open with a metadata
// block (meta.ts) before its H1; a file without one reads exactly as before.
import { type GroupMetaRaw, splitGroupMeta } from "./meta.ts";
import { parseProse } from "./taken.ts";
import { formatStepRow, parseRow, statedNextFree, type StepRow } from "./steps.ts";

export interface GroupDoc {
  slug: string;
  summary: string;
  /** The bold first sentence, without its `**`; empty when the group opens with a plain paragraph, or has none. */
  lead: string;
  /** Paragraphs between the lead and `Steps:`; empty for a plain group (H1 and `## Record` alone). */
  paragraphs: string[];
  steps: number[];
  binds: string;
  rows: StepRow[];
  /** The document's lines, the metadata block (when there is one) first, then the heading. */
  lines: string[];
  /** Index of the `## Record` line, in `lines` (the block included). */
  proseEnd: number;
  /** The metadata block as written, when the file has a readable one (meta.ts). */
  meta?: GroupMetaRaw;
  /** Why the block could not be read, when it could not. */
  metaError?: string;
  /** Index of the H1: one past the block, 0 without one. */
  metaEnd: number;
}

const HEADING = /^# ([a-z0-9-]+) — (.+)$/;
const RECORD_HEADING = "## Record";
const ROW = /^\| (\d+) \|/;
/** The `## Record` table's `section` cell for every row of a group: there is only ever the one table. */
const RECORD_SECTION = "Record";

export function parseGroup(text: string, slugExpected?: string): GroupDoc {
  const lines = text.split("\n");
  const block = splitGroupMeta(lines);
  const metaEnd = block.end;

  const m = (lines[metaEnd] ?? "").match(HEADING);
  if (!m) {
    if (block.error && !metaEnd) throw new Error(`line 1: ${block.error}`);
    throw new Error(`line ${metaEnd + 1}: a group heading is "# <slug> — <summary>": ${lines[metaEnd]}`);
  }
  const [, slug, summary] = m as [string, string, string];
  if (slugExpected !== undefined && slugExpected !== slug) {
    throw new Error(`the file's H1 names slug ${slug}, not ${slugExpected}`);
  }

  const proseEnd = lines.indexOf(RECORD_HEADING);
  if (proseEnd === -1) throw new Error(`a group has no "${RECORD_HEADING}" heading: ${slug}`);

  const prose = parseProse(lines.slice(metaEnd + 1, proseEnd));

  const rows: StepRow[] = [];
  for (let i = proseEnd + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (ROW.test(line)) rows.push(parseRow(line, i, RECORD_SECTION));
  }

  return {
    slug,
    summary,
    ...prose,
    rows,
    lines,
    proseEnd,
    metaEnd,
    ...(block.meta ? { meta: block.meta } : {}),
    ...(block.error ? { metaError: block.error } : {}),
  };
}

export function serializeGroup(doc: GroupDoc): string {
  const lines = [...doc.lines];
  for (const row of doc.rows) lines[row.line] = formatStepRow(row);
  return lines.join("\n");
}

export interface RecordReadmeDoc {
  lines: string[];
  /** The slugs under `## Groups`, in the order written. */
  order: string[];
  statedNextFree?: number;
}

const GROUPS_HEADING = "## Groups";
const GROUP_ITEM = /^- (.+)$/;

/**
 * The separate index file naming every group and the next free number — `# Decisions taken`, a lead
 * sentence with "**The next free number is …**", then `## Groups` and one `- <slug>` per line.
 */
export function parseRecordReadme(text: string): RecordReadmeDoc {
  const lines = text.split("\n");
  const groupsAt = lines.indexOf(GROUPS_HEADING);
  const order: string[] = [];
  if (groupsAt !== -1) {
    for (const l of lines.slice(groupsAt + 1)) {
      if (l.startsWith("#")) break;
      const m = l.match(GROUP_ITEM);
      if (m) order.push(m[1]!);
    }
  }
  const next = statedNextFree(text);
  return { lines, order, ...(next !== undefined ? { statedNextFree: next } : {}) };
}

export function serializeRecordReadme(doc: Pick<RecordReadmeDoc, "lines">): string {
  return doc.lines.join("\n");
}
