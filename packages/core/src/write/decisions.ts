// Decision writes (PLAN.md § 5.2): open, edit and withdraw a pending question; answer it with a new row of the
// record; supersede a row; mark a review item; add a retired form. Each keeps the files' own conventions:
// numbers never reused, the next free number stated alike in the record and the pending page, English only.
//
// answer/supersede/setCell/refile/subjectNew assume the decisions-taken/ directory layout (one README.md index
// plus a GroupDoc file per subject, group.ts): store.ts's loadStore reads nothing else any more, so `record` is
// always present on a Model loadModel built. recordOrThrow still refuses a `record`-less Model outright — kept
// as a defensive check against a Model some other code assembled by hand (a script, a test) rather than through
// loadModel/loadStore, never a live second path these five writes carry.
import { joinRow } from "../md/table.ts";
import { parseGroup } from "../decisions/group.ts";
import { deriveGroupMeta, type GroupMeta, groupMetaProblems, splitGroupMeta, withGroupMeta } from "../decisions/meta.ts";
import { parseRetired, type RetiredDoc } from "../decisions/retired.ts";
import { parseNumberList } from "../decisions/taken.ts";
import type { PendingEntry, PendingSection } from "../decisions/pending.ts";
import type { Model } from "../model.ts";
import { etagOf, type Plan, WriteError } from "./plan.ts";

const PENDING = "specs/decisions-pending.md";
const RETIRED = "specs/retired.md";

const RECORD_DIR = "specs/decisions-taken";
const RECORD_README = `${RECORD_DIR}/README.md`;
const groupPath = (slug: string) => `${RECORD_DIR}/${slug}.md`;

const GROUPS_HEADING = "## Groups";
const GROUP_ITEM = /^- (.+)$/;
/** A group's `## Record` table row, read the same way group.ts's own `ROW` does. */
const RECORD_ROW = /^\| (\d+) \|/;
/** A GFM table separator row: `|---|---|...|`, dashes and colons only between the pipes. */
const RECORD_SEPARATOR = /^\|[-:\s|]+\|$/;

/** The four fields every pending question carries, in their order (decisions-pending.md's head). */
export const PENDING_FIELDS = ["Measured", "Options", "Recommendation", "Blocks"] as const;

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** What a row's Cell may name (decision 1022): a conformance cell's slug, a test script, or the conformance self-test. */
const CELL = /^(?:[a-z0-9]+(?:_[a-z0-9]+)*|tests\/[A-Za-z0-9_.-]+\.sh|conformance\/run\.sh --self-test)$/;

/**
 * A group's lines with its metadata block's derived keys recomputed from those very lines (and `retired`), the
 * hand-written keys kept as written. A group with no block, or one whose block is unreadable or malformed, is
 * returned unchanged: the layout before the block, or a defect check.ts reports, never one a write papers over.
 */
function keepMeta(lines: string[], slug: string, retired: RetiredDoc): string[] {
  const { meta, error } = splitGroupMeta(lines);
  if (!meta || error || groupMetaProblems(meta).length) return lines;
  const rows = parseGroup(lines.join("\n"), slug).rows;
  return withGroupMeta(lines, { ...(meta as GroupMeta), ...deriveGroupMeta(rows, retired) });
}

/** Whether a group carries a metadata block: the compact layout, where a superseded row keeps only its stub. */
const hasMeta = (lines: string[]) => splitGroupMeta(lines).end > 0;

function oneLine(text: string, what: string): string {
  const t = text.replace(/\s*\n\s*/g, " ").trim();
  if (!t) throw new WriteError("invalid", `${what} is empty`);
  return t;
}

/** A bare `|` would split a table row: escape it. */
function cellText(text: string): string {
  return text.replace(/(?<!\\)\|/g, "\\|");
}

function today(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
}

/** Refuses a model built over the old flat files: these five writes know only the decisions-taken/ layout. */
function recordOrThrow(model: Model, fns: string): NonNullable<Model["record"]> {
  if (!model.record) {
    throw new WriteError("invalid", `${fns} precisam do layout novo de decisions-taken/ (model.record ausente); rode a migração primeiro`);
  }
  return model.record;
}

/**
 * A section of the pending page by its heading: exact; else the one whose name (before " — ") is the words;
 * else the one heading that contains them. "machine 1" is "Machine 1 — maximum priority …", not
 * "Blocking now — machine 1 and front 165".
 */
function pendingSection(model: Model, name: string): PendingSection {
  const sections = model.pending.sections.filter((s) => !s.heading.startsWith("To review"));
  const words = name.trim().toLowerCase();
  const tiers = [
    (s: PendingSection) => s.heading === name,
    (s: PendingSection) => s.heading.split(" — ")[0]!.toLowerCase() === words,
    (s: PendingSection) => s.heading.toLowerCase().startsWith(words),
    (s: PendingSection) => s.heading.toLowerCase().includes(words),
  ];
  for (const tier of tiers) {
    const found = sections.filter(tier);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) {
      throw new WriteError("invalid", `"${name}" names ${found.length} sections`, `one of: ${found.map((s) => s.heading).join(" · ")}`);
    }
  }
  throw new WriteError("invalid", `no pending section "${name}"`, `one of: ${sections.map((s) => s.heading.split(" — ")[0]).join(" · ")}`);
}

function entryFor(model: Model, id: string): PendingEntry {
  const e = model.entries.find((x) => x.id === id);
  if (!e) {
    const step = model.answeredBy.get(id);
    throw new WriteError("not-found", `pending ${id} not found`, step ? `answered by step ${step}` : "specs-bot pending lists the open ones");
  }
  return e;
}

/** The line where a section of the pending page ends (the next `##`, or the end), before its trailing blank lines. */
function sectionEnd(lines: string[], s: PendingSection): number {
  let end = lines.findIndex((l, i) => i > s.line && l.startsWith("## "));
  if (end < 0) end = lines.length;
  while (end > s.line + 1 && lines[end - 1]!.trim() === "") end--;
  return end;
}

function fieldLines(name: string, text: string): string[] {
  const [first, ...rest] = text.replace(/\s+$/, "").split("\n");
  return [`- **${name}.** ${first!.trim()}`, ...rest.map((l) => `  ${l.trim()}`)];
}

function entryEtag(e: PendingEntry): string {
  return etagOf(e.lines.join("\n"));
}

export { entryEtag as pendingEtag };

// ── pending ────────────────────────────────────────────────────────────────────────────────────────────────

export interface PendingInput {
  id: string;
  section: string;
  title: string;
  /** Measured, Options, Recommendation and Blocks — all four, as the page's head asks. */
  fields: Record<string, string>;
}

export function pendingAdd(model: Model, input: PendingInput): Plan {
  const id = input.id.trim();
  if (!ID.test(id)) throw new WriteError("invalid", `a question's id is lowercase letters, digits and hyphens: ${id}`);
  if (model.entries.some((e) => e.id === id)) throw new WriteError("invalid", `pending ${id} is already open`);
  const answered = model.answeredBy.get(id);
  if (answered !== undefined) throw new WriteError("invalid", `${id} was answered by step ${answered}; an id is never reused`);
  const title = oneLine(input.title, "the title");
  const missing = PENDING_FIELDS.filter((f) => !input.fields[f]?.trim());
  if (missing.length) throw new WriteError("invalid", `a question carries ${PENDING_FIELDS.join(", ")}; missing: ${missing.join(", ")}`);

  const s = pendingSection(model, input.section);
  const lines = model.pending.lines;
  const at = sectionEnd(lines, s);
  const block = [`#### ${id} · ${title}`, ...PENDING_FIELDS.flatMap((f) => fieldLines(f, input.fields[f]!))];
  const after = [...lines.slice(0, at), "", ...block, ...lines.slice(at)];
  return {
    op: "pending.add",
    refs: [`pending ${id}`],
    message: `spec: question ${id} — ${title}`,
    summary: `open question ${id} in § ${s.heading.split(" — ")[0]}`,
    changes: [{ path: PENDING, before: lines.join("\n"), after: after.join("\n") }],
  };
}

export function pendingEdit(model: Model, input: { id: string; etag: string; title?: string; fields?: Record<string, string> }): Plan {
  const e = entryFor(model, input.id);
  if (input.etag !== entryEtag(e)) {
    throw new WriteError("conflict", `pending ${e.id} changed since it was read`, "read it again and redo the edit", { etag: entryEtag(e) });
  }
  const block = [...e.lines];
  if (input.title !== undefined) block[0] = `#### ${e.id} · ${oneLine(input.title, "the title")}`;
  for (const [name, text] of Object.entries(input.fields ?? {})) {
    const start = block.findIndex((l, i) => i > 0 && l.startsWith(`- **${name}.**`));
    const replacement = fieldLines(name, text);
    if (start < 0) {
      let last = block.length;
      while (last > 1 && block[last - 1]!.trim() === "") last--;
      block.splice(last, 0, ...replacement);
    } else {
      let end = start + 1;
      while (end < block.length && /^\s+\S/.test(block[end]!)) end++;
      block.splice(start, end - start, ...replacement);
    }
  }
  const lines = model.pending.lines;
  const after = [...lines.slice(0, e.line), ...block, ...lines.slice(e.line + e.lines.length)];
  const changed = [...(input.title !== undefined ? ["title"] : []), ...Object.keys(input.fields ?? {})];
  if (!changed.length) throw new WriteError("invalid", "nothing to change: give a title or a field");
  return {
    op: "pending.edit",
    refs: [`pending ${e.id}`],
    message: `spec: question ${e.id} — ${changed.join(", ")} revised`,
    summary: `revise ${changed.join(", ")} of question ${e.id}`,
    changes: [{ path: PENDING, before: lines.join("\n"), after: after.join("\n") }],
  };
}

export function pendingWithdraw(model: Model, input: { id: string; reason: string }): Plan {
  const e = entryFor(model, input.id);
  const reason = oneLine(input.reason, "the reason");
  const lines = model.pending.lines;
  let start = e.line;
  // The blank line before the block goes with it, so the page keeps one blank line between blocks.
  if (start > 0 && lines[start - 1]!.trim() === "" && (lines[e.line + e.lines.length] ?? "").trim() === "") start--;
  const after = [...lines.slice(0, start), ...lines.slice(e.line + e.lines.length)];
  return {
    op: "pending.withdraw",
    refs: [`pending ${e.id}`],
    message: `spec: question ${e.id} withdrawn — ${reason}`,
    summary: `withdraw question ${e.id}: ${reason}`,
    changes: [{ path: PENDING, before: lines.join("\n"), after: after.join("\n") }],
  };
}

// ── the record (decisions-taken/) ─────────────────────────────────────────────────────────────────────────

/** The `## Groups` list's line range: just after the heading, up to (not including) its trailing blank lines. */
function groupsListRange(lines: string[]): { at: number; end: number } {
  const at = lines.indexOf(GROUPS_HEADING);
  if (at === -1) throw new WriteError("invalid", `decisions-taken/README.md has no "${GROUPS_HEADING}" heading`);
  let end = at + 1;
  while (end < lines.length && !lines[end]!.startsWith("#")) end++;
  while (end > at + 1 && lines[end - 1]!.trim() === "") end--;
  return { at, end };
}

/** Adds `slug` to the README's `## Groups` list — right before the item named `before` when given, else at the end. */
function addGroupToReadme(lines: string[], slug: string, before?: string): string[] {
  const { at, end } = groupsListRange(lines);
  let insertAt = end;
  if (before !== undefined) {
    for (let i = at + 1; i < end; i++) {
      const m = lines[i]!.match(GROUP_ITEM);
      if (m && m[1] === before) {
        insertAt = i;
        break;
      }
    }
  }
  return [...lines.slice(0, insertAt), `- ${slug}`, ...lines.slice(insertAt)];
}

/**
 * The next free number stated in a file's text moves from n to n + 1. Shared by the README (the record's own
 * count) and decisions-pending.md (which states the same number on its own, and must move in step).
 */
function bumpNextFree(text: string, n: number, path: string, required = true): string {
  const rx = /(next free\s+number,?\s+(?:which\s+)?is\s+\**)(\d+)/;
  const m = text.match(rx);
  if (!m) {
    if (required) throw new WriteError("invalid", `${path} does not state the next free number`);
    return text;
  }
  if (Number(m[2]) !== n) throw new WriteError("conflict", `${path} states ${m[2]} as the next free number, the record makes it ${n}`, "specs-bot check");
  return text.replace(rx, `$1${n + 1}`);
}

/**
 * Where a new row of a group's `## Record` table goes: right after its last existing row; or, a table with
 * none yet, right after its header and separator lines when they are there, else right after the heading itself.
 */
function recordInsertAt(lines: string[], proseEnd: number): number {
  let last = -1;
  for (let i = proseEnd + 1; i < lines.length; i++) if (RECORD_ROW.test(lines[i]!)) last = i;
  if (last !== -1) return last + 1;
  let at = proseEnd + 1;
  while (at < lines.length && lines[at]!.trim() === "") at++;
  if (at < lines.length && lines[at]!.startsWith("|")) at++;
  if (at < lines.length && RECORD_SEPARATOR.test(lines[at]!)) at++;
  return at;
}

/** Adds `num` to a group's `Steps:` list, in its prose (before `proseEnd`) — a new `Steps:` line when it has none yet. */
function addToSteps(lines: string[], proseEnd: number, num: number): { lines: string[]; proseEnd: number } {
  const out = [...lines];
  const idx = out.findIndex((l, i) => i < proseEnd && l.startsWith("Steps:"));
  if (idx !== -1) {
    const current = parseNumberList(out[idx]!.slice("Steps:".length));
    if (!current.includes(num)) out[idx] = `Steps: ${[...current, num].join(", ")}`;
    return { lines: out, proseEnd };
  }
  let at = proseEnd;
  while (at > 0 && out[at - 1]!.trim() === "") at--;
  out.splice(at, 0, "", `Steps: ${num}`);
  return { lines: out, proseEnd: proseEnd + 2 };
}

/**
 * `answer --subject`'s prose edit, inside the target group's own lines: `Steps:`/`Binds:` updated in place, or
 * inserted when the group has neither yet (the shape `answer` itself just gave a freshly auto-created group,
 * when that very group is the one named by `--subject`); the paragraph, if given, lands right before `Steps:`.
 */
function applySubject(lines: string[], proseEnd: number, num: number, binds: string, subjectText?: string): { lines: string[]; proseEnd: number } {
  const out = [...lines];
  let end = proseEnd;

  const stepsIdx = out.findIndex((l, i) => i < end && l.startsWith("Steps:"));
  if (stepsIdx !== -1) {
    const current = parseNumberList(out[stepsIdx]!.slice("Steps:".length));
    out[stepsIdx] = `Steps: ${[...current, num].join(", ")}`;
  }
  const bindsIdx = out.findIndex((l, i) => i < end && l.startsWith("Binds:"));
  if (bindsIdx !== -1) {
    const priorBinds = out[bindsIdx]!.slice("Binds:".length).trim();
    if (!priorBinds.includes(binds)) out[bindsIdx] = `Binds: ${priorBinds} · ${binds}`;
  }

  const missing = [...(stepsIdx === -1 ? [`Steps: ${num}`] : []), ...(bindsIdx === -1 ? [`Binds: ${binds}`] : [])];
  if (missing.length) {
    let at = end;
    while (at > 0 && out[at - 1]!.trim() === "") at--;
    out.splice(at, 0, "", ...missing);
    end += missing.length + 1;
  }

  if (subjectText?.trim()) {
    const stepsLine = out.findIndex((l, i) => i < end && l.startsWith("Steps:"));
    let at = stepsLine;
    while (at > 0 && out[at - 1]!.trim() === "") at--;
    const text = subjectText.trim().split("\n");
    out.splice(at, 0, "", ...text);
    end += text.length + 1;
  }

  return { lines: out, proseEnd: end };
}

// ── answer ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface AnswerInput {
  /** The pending id it answers (removed from the page); or a new id for a ruling no question asked. */
  id: string;
  rule: string;
  binds: string;
  cell?: string;
  process?: boolean;
  /** Who decided, as the Id cell says it: "the maintainer", "the coordinator †". Default from the party. */
  by?: string;
  /** A sentence for the subject of decisions-taken.md the row joins, with --subject. */
  subject?: string;
  subjectText?: string;
  at?: Date;
}

export function answer(model: Model, input: AnswerInput, party: string): Plan {
  const rec = recordOrThrow(model, "answer/supersede/setCell");
  const id = input.id.trim();
  if (!ID.test(id)) throw new WriteError("invalid", `an id is lowercase letters, digits and hyphens: ${id}`);
  const answered = model.answeredBy.get(id);
  if (answered !== undefined) throw new WriteError("invalid", `${id} was already answered by step ${answered}`);
  const n = model.nextFree;
  const by = input.by?.trim() || (party === "maintainer" ? "the maintainer" : "the coordinator †");
  const rule = cellText(oneLine(input.rule, "the rule"));
  const binds = cellText(oneLine(input.binds, "binds"));
  const cell = input.cell ? cellText(input.cell.trim()) : "";
  if (cell && !CELL.test(cell)) throw new WriteError("invalid", `a Cell is a cell slug (lowercase_with_underscores), tests/<name>.sh or conformance/run.sh --self-test: ${cell}`);
  const idCell = `${id} · (${by}, ${today(input.at)})${input.process ? " · (process)" : ""}`;
  const row = joinRow([` ${n} `, ` ${idCell} `, ` ${rule} `, ` ${binds} `, cell ? ` ${cell} ` : " "]);

  // The target group: input.subject's, or "unfiled" when no subject names one. Only "unfiled" is ever
  // auto-created here (the first time it is missing); any other named subject that does not exist is the
  // caller's error.
  const targetSlug = input.subject ?? "unfiled";
  const existing = rec.groups.get(targetSlug);
  if (!existing && targetSlug !== "unfiled") {
    throw new WriteError("not-found", `subject ${targetSlug} not found`, "specs-bot subject lists them");
  }
  const groupBefore = existing ? existing.lines.join("\n") : null;
  let groupLines = existing
    ? [...existing.lines]
    : ["# unfiled — decisions no subject cites", "", "## Record", "", "| # | Id | Rule in force | Binds | Cell |", "|---|---|---|---|---|", ""];
  let proseEnd = existing ? existing.proseEnd : groupLines.indexOf("## Record");

  if (input.subject) {
    const applied = applySubject(groupLines, proseEnd, n, input.binds.trim(), input.subjectText);
    groupLines = applied.lines;
    proseEnd = applied.proseEnd;
  }
  groupLines.splice(recordInsertAt(groupLines, proseEnd), 0, row);
  groupLines = keepMeta(groupLines, targetSlug, model.retired);

  // The README: the next free number always; the new group listed too, when answer itself just created it.
  let readmeLines = [...rec.readme.lines];
  if (!existing) readmeLines = addGroupToReadme(readmeLines, targetSlug);
  const readmeAfter = bumpNextFree(readmeLines.join("\n"), n, RECORD_README);

  // decisions-pending.md: the question leaves, a delegated decision is marked for the maintainer's review, and
  // its own stated next-free number moves in step with the README's — untouched by the group/subject split.
  let pending = [...model.pending.lines];
  const open = model.entries.find((e) => e.id === id);
  if (open) {
    let start = open.line;
    if (start > 0 && pending[start - 1]!.trim() === "" && (pending[open.line + open.lines.length] ?? "").trim() === "") start--;
    pending = [...pending.slice(0, start), ...pending.slice(open.line + open.lines.length)];
  }
  const delegated = by.includes("†") || party !== "maintainer";
  if (delegated && model.pending.review.length) {
    const lastReview = pending.findLastIndex((l) => /^\| \[( |x)\] \| \d+ \|/.test(l));
    const what = rule.replace(/\*\*/g, "").split(/(?<=\.)\s/)[0]!.slice(0, 200);
    pending.splice(lastReview + 1, 0, `| [ ] | ${n} | ${id} | ${what} |`);
  }
  const pendingText = bumpNextFree(pending.join("\n"), n, PENDING, false);

  const changes: Plan["changes"] = [
    { path: groupPath(targetSlug), before: groupBefore, after: groupLines.join("\n") },
    { path: RECORD_README, before: rec.readme.lines.join("\n"), after: readmeAfter },
    { path: PENDING, before: model.pending.lines.join("\n"), after: pendingText },
  ];

  return {
    op: "answer",
    refs: [`step ${n}`, ...(open ? [`pending ${id}`] : []), ...(input.subject ? [`subject ${input.subject}`] : [])],
    message: `spec: row ${n} answers ${id}`,
    summary: `step ${n} answers ${id}${open ? " (the question leaves the page)" : ""}${delegated ? "; marked for review" : ""}`,
    changes,
  };
}

// ── supersede, review, retired, cell ───────────────────────────────────────────────────────────────────────

export function supersede(model: Model, input: { num: number; by: number; kind: "overtaken" | "replaced" | "reversed" }): Plan {
  const rec = recordOrThrow(model, "answer/supersede/setCell");
  const row = model.stepByNum.get(input.num);
  if (!row) throw new WriteError("not-found", `step ${input.num} not found`);
  if (row.status !== "in-force") throw new WriteError("invalid", `step ${input.num} is already ${row.status} by ${row.supersededBy}`);
  if (!model.stepByNum.has(input.by)) throw new WriteError("not-found", `step ${input.by} not found`, "the row in force is written first (specs-bot answer)");
  if (input.by <= input.num) throw new WriteError("invalid", `a row is superseded by a later one: ${input.by} ≤ ${input.num}`);
  const group = rec.groups.get(row.section)!;
  const kind = input.kind[0]!.toUpperCase() + input.kind.slice(1);
  // A group with a metadata block is the compact layout: the row keeps only its stub, the text as decided is in
  // git's history. Without one, the row keeps its text after the stub, as it always did.
  const rule = hasMeta(group.lines) ? `${kind} by ${input.by}` : `${kind} by ${input.by} (the later row in force, 730); the text as decided: ${row.rule}`;
  const edited = [...group.lines];
  edited[row.line] = joinRow([row.raw.num, row.raw.id, ` ${rule} `, row.raw.binds, row.raw.cell]);
  const lines = keepMeta(edited, row.section, model.retired);
  return {
    op: "supersede",
    refs: [`step ${input.num}`],
    message: `spec: row ${input.num} ${input.kind} by ${input.by}`,
    summary: `step ${input.num} ${input.kind} by ${input.by}`,
    changes: [{ path: groupPath(row.section), before: group.lines.join("\n"), after: lines.join("\n") }],
  };
}

export function markReviewed(model: Model, input: { num: number }, party: string): Plan {
  if (party !== "maintainer") throw new WriteError("forbidden", "only the maintainer marks a decision reviewed");
  const item = model.pending.review.find((r) => r.step === input.num);
  if (!item) throw new WriteError("not-found", `step ${input.num} is not in the To review table`);
  if (item.reviewed) throw new WriteError("invalid", `step ${input.num} is already reviewed`);
  const lines = [...model.pending.lines];
  lines[item.line] = lines[item.line]!.replace("| [ ] |", "| [x] |");
  return {
    op: "review",
    refs: [`step ${input.num}`],
    message: `spec: ${input.num} reviewed`,
    summary: `mark step ${input.num} reviewed`,
    changes: [{ path: PENDING, before: model.pending.lines.join("\n"), after: lines.join("\n") }],
  };
}

export function retiredAdd(model: Model, input: { area: string; retired: string; replacedBy: string; decisions: string; note?: string }): Plan {
  const areas = [...new Set(model.retired.rows.map((r) => r.area))];
  const area = areas.find((a) => a === input.area) ?? (() => {
    const found = areas.filter((a) => a.toLowerCase().includes(input.area.toLowerCase()));
    if (found.length === 1) return found[0]!;
    throw new WriteError("invalid", found.length ? `"${input.area}" names ${found.length} areas` : `no retired area "${input.area}"`, `one of: ${areas.join(" · ")}`);
  })();
  const decisions = oneLine(input.decisions, "decisions");
  const cited = [...decisions.replace(/\([^)]*\)/g, "").matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
  const unknown = cited.filter((n) => !model.stepByNum.has(n));
  if (unknown.length) throw new WriteError("invalid", `decisions cites rows that do not exist: ${unknown.join(", ")}`);
  const last = Math.max(...model.retired.rows.filter((r) => r.area === area).map((r) => r.line));
  const cells = [input.retired, input.replacedBy, decisions, input.note ?? ""].map((c, i) => (i < 3 ? cellText(oneLine(c, ["retired", "replacedBy"][i] ?? "")) : cellText(c.trim())));
  const lines = [...model.retired.lines];
  lines.splice(last + 1, 0, joinRow(cells.map((c) => ` ${c} `)));
  // Every group whose rows the new line cites lists the form in its block's `retired` (when it has a block).
  const retiredAfter = parseRetired(lines.join("\n"));
  const groupChanges: Plan["changes"] = [];
  for (const [slug, g] of model.record?.groups ?? []) {
    if (!g.rows.some((r) => cited.includes(r.num))) continue;
    const after = keepMeta(g.lines, slug, retiredAfter);
    if (after.join("\n") !== g.lines.join("\n")) groupChanges.push({ path: groupPath(slug), before: g.lines.join("\n"), after: after.join("\n") });
  }
  return {
    op: "retired.add",
    refs: [`retired ${input.retired}`],
    message: `spec: retired ${input.retired} → ${input.replacedBy}`,
    summary: `retire ${input.retired} (${area})`,
    changes: [{ path: RETIRED, before: model.retired.lines.join("\n"), after: lines.join("\n") }, ...groupChanges],
  };
}

/** Sets one row's Cell (decision 1022); its number, Id, rule and Binds stay as written. */
export function setCell(model: Model, input: { num: number; value: string }): Plan {
  const rec = recordOrThrow(model, "answer/supersede/setCell");
  const row = model.stepByNum.get(input.num);
  if (!row) throw new WriteError("not-found", `step ${input.num} not found`);
  const value = input.value.trim();
  if (!CELL.test(value)) {
    throw new WriteError("invalid", `a Cell is a cell slug (lowercase_with_underscores), tests/<name>.sh or conformance/run.sh --self-test: ${value}`);
  }
  if (row.cell === value) throw new WriteError("invalid", `step ${input.num}'s Cell is already ${value}`);
  const group = rec.groups.get(row.section)!;
  const lines = [...group.lines];
  lines[row.line] = joinRow([row.raw.num, row.raw.id, row.raw.rule, row.raw.binds, ` ${value} `]);
  return {
    op: "step.cell",
    refs: [`step ${input.num}`],
    message: `spec: row ${input.num} cell → ${value}`,
    summary: `step ${input.num}'s Cell: ${row.cell || "(empty)"} → ${value}`,
    changes: [{ path: groupPath(row.section), before: group.lines.join("\n"), after: lines.join("\n") }],
  };
}

// ── refile, subjectNew ────────────────────────────────────────────────────────────────────────────────────

/**
 * Moves row `num`'s home from its current group to `to` — its line cut from the origin's `## Record` table,
 * appended to the destination's. `cite` (optional) also adds `num` to the destination's own `Steps:`, leaving
 * every other subject that already cites it untouched: home and citation are independent, and a row may be
 * cited from a subject it does not live in.
 */
export function refile(model: Model, input: { num: number; to: string; cite?: boolean }): Plan {
  const rec = recordOrThrow(model, "refile/subjectNew");
  const row = model.stepByNum.get(input.num);
  if (!row) throw new WriteError("not-found", `step ${input.num} not found`);
  const toGroup = rec.groups.get(input.to);
  if (!toGroup) throw new WriteError("not-found", `subject ${input.to} not found`, "specs-bot subject lists them");
  const fromSlug = row.section;
  if (fromSlug === input.to) throw new WriteError("invalid", `step ${input.num} is already in ${input.to}`);
  const fromGroup = rec.groups.get(fromSlug)!;

  const cut = [...fromGroup.lines];
  cut.splice(row.line, 1);
  const fromLines = keepMeta(cut, fromSlug, model.retired);

  let toLines = [...toGroup.lines];
  let toProseEnd = toGroup.proseEnd;
  if (input.cite && !toGroup.steps.includes(input.num)) {
    const added = addToSteps(toLines, toProseEnd, input.num);
    toLines = added.lines;
    toProseEnd = added.proseEnd;
  }
  const rowText = joinRow([row.raw.num, row.raw.id, row.raw.rule, row.raw.binds, row.raw.cell]);
  toLines.splice(recordInsertAt(toLines, toProseEnd), 0, rowText);
  toLines = keepMeta(toLines, input.to, model.retired);

  return {
    op: "refile",
    refs: [`step ${input.num}`],
    message: `spec: row ${input.num} refiled ${fromSlug} → ${input.to}`,
    summary: `move step ${input.num} from ${fromSlug} to ${input.to}${input.cite ? "; cited in its Steps" : ""}`,
    changes: [
      { path: groupPath(fromSlug), before: fromGroup.lines.join("\n"), after: fromLines.join("\n") },
      { path: groupPath(input.to), before: toGroup.lines.join("\n"), after: toLines.join("\n") },
    ],
  };
}

/** Opens a new, empty group file (no rows yet) and lists it in the README, right before "unfiled" when one is listed. */
export function subjectNew(model: Model, input: { slug: string; summary: string; lead?: string; binds?: string }): Plan {
  const rec = recordOrThrow(model, "refile/subjectNew");
  const slug = input.slug.trim();
  if (!ID.test(slug)) throw new WriteError("invalid", `a subject's slug is lowercase letters, digits and hyphens: ${slug}`);
  if (slug === "unfiled" || slug === "readme") throw new WriteError("invalid", `${slug} is reserved`);
  if (rec.groups.has(slug)) throw new WriteError("invalid", `subject ${slug} already exists`);
  const summary = oneLine(input.summary, "the summary");
  const lead = input.lead?.trim();
  const binds = input.binds?.trim();

  const lines = [`# ${slug} — ${summary}`, ""];
  if (lead) lines.push(`**${lead}**`, "");
  // Steps: is written with no numbers yet — parseNumberList("") reads it as [], the same as a group with none.
  lines.push("Steps:");
  if (binds) lines.push(`Binds: ${binds}`);
  lines.push("", "## Record", "", "| # | Id | Rule in force | Binds | Cell |", "|---|---|---|---|---|", "");

  const readmeAfter = addGroupToReadme([...rec.readme.lines], slug, rec.readme.order.includes("unfiled") ? "unfiled" : undefined);

  return {
    op: "subject.new",
    refs: [`subject ${slug}`],
    message: `spec: subject ${slug} — ${summary}`,
    summary: `new subject ${slug}`,
    changes: [
      { path: groupPath(slug), before: null, after: lines.join("\n") },
      { path: RECORD_README, before: rec.readme.lines.join("\n"), after: readmeAfter.join("\n") },
    ],
  };
}
