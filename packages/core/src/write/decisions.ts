// Decision writes (PLAN.md § 5.2): open, edit and withdraw a pending question; answer it with a new row of the
// record; supersede a row; mark a review item; add a retired form. Each keeps the files' own conventions:
// numbers never reused, the next free number stated alike in the record and the pending page, English only.
import { joinRow } from "../md/table.ts";
import type { PendingEntry, PendingSection } from "../decisions/pending.ts";
import type { Model } from "../model.ts";
import { etagOf, type Plan, WriteError } from "./plan.ts";

const STEPS = "specs/decisions-taken-steps.md";
const PENDING = "specs/decisions-pending.md";
const TAKEN = "specs/decisions-taken.md";
const RETIRED = "specs/retired.md";

/** The four fields every pending question carries, in their order (decisions-pending.md's head). */
export const PENDING_FIELDS = ["Measured", "Options", "Recommendation", "Blocks"] as const;

const ID = /^[a-z0-9][a-z0-9-]*$/;

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

/** A section of the pending page by its heading: exact, else the one heading that contains the words. */
function pendingSection(model: Model, name: string): PendingSection {
  const sections = model.pending.sections.filter((s) => !s.heading.startsWith("To review"));
  const exact = sections.find((s) => s.heading === name);
  if (exact) return exact;
  const words = name.toLowerCase();
  const found = sections.filter((s) => s.heading.toLowerCase().includes(words));
  if (found.length === 1) return found[0]!;
  const list = sections.map((s) => s.heading.split(" — ")[0]).join(" · ");
  throw new WriteError("invalid", found.length ? `"${name}" names ${found.length} sections` : `no pending section "${name}"`, `one of: ${list}`);
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
  const id = input.id.trim();
  if (!ID.test(id)) throw new WriteError("invalid", `an id is lowercase letters, digits and hyphens: ${id}`);
  const answered = model.answeredBy.get(id);
  if (answered !== undefined) throw new WriteError("invalid", `${id} was already answered by step ${answered}`);
  const n = model.nextFree;
  const by = input.by?.trim() || (party === "maintainer" ? "the maintainer" : "the coordinator †");
  const rule = cellText(oneLine(input.rule, "the rule"));
  const binds = cellText(oneLine(input.binds, "binds"));
  const cell = input.cell ? cellText(input.cell.trim()) : "";
  if (cell && !/^[a-z0-9_]+$/.test(cell)) throw new WriteError("invalid", `a cell's slug is lowercase letters, digits and _: ${cell}`);
  const idCell = `${id} · (${by}, ${today(input.at)})${input.process ? " · (process)" : ""}`;
  const row = joinRow([` ${n} `, ` ${idCell} `, ` ${rule} `, ` ${binds} `, cell ? ` ${cell} ` : " "]);

  // The record: the row after the last row of the file, and the head's next free number.
  const steps = [...model.steps.lines];
  const last = Math.max(...model.steps.rows.map((r) => r.line));
  steps.splice(last + 1, 0, row);
  const stepsText = bumpNextFree(steps.join("\n"), n, STEPS);

  // The pending page: the question leaves, a delegated decision is marked for the maintainer's review, the number moves.
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
    { path: STEPS, before: model.steps.lines.join("\n"), after: stepsText },
    { path: PENDING, before: model.pending.lines.join("\n"), after: pendingText },
  ];

  if (input.subject) {
    const s = model.subjectBySlug.get(input.subject);
    if (!s) throw new WriteError("not-found", `subject ${input.subject} not found`, "specs-bot subject lists them");
    const taken = [...model.taken.lines];
    const stepsAt = s.line + s.lines.findIndex((l) => l.startsWith("Steps:"));
    const bindsAt = s.line + s.lines.findIndex((l) => l.startsWith("Binds:"));
    taken[stepsAt] = `Steps: ${[...s.steps, n].join(", ")}`;
    if (!s.binds.includes(input.binds.trim())) taken[bindsAt] = `Binds: ${s.binds} · ${input.binds.trim()}`;
    if (input.subjectText?.trim()) {
      let at = stepsAt;
      while (at > s.line && taken[at - 1]!.trim() === "") at--;
      taken.splice(at, 0, "", ...input.subjectText.trim().split("\n"));
    }
    changes.push({ path: TAKEN, before: model.taken.lines.join("\n"), after: taken.join("\n") });
  }

  return {
    op: "answer",
    refs: [`step ${n}`, ...(open ? [`pending ${id}`] : []), ...(input.subject ? [`subject ${input.subject}`] : [])],
    message: `spec: row ${n} answers ${id}`,
    summary: `step ${n} answers ${id}${open ? " (the question leaves the page)" : ""}${delegated ? "; marked for review" : ""}`,
    changes,
  };
}

/** The next free number stated in a file's text moves from n to n + 1. */
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

// ── supersede, review, retired ─────────────────────────────────────────────────────────────────────────────

export function supersede(model: Model, input: { num: number; by: number; kind: "overtaken" | "replaced" | "reversed" }): Plan {
  const row = model.stepByNum.get(input.num);
  if (!row) throw new WriteError("not-found", `step ${input.num} not found`);
  if (row.status !== "in-force") throw new WriteError("invalid", `step ${input.num} is already ${row.status} by ${row.supersededBy}`);
  if (!model.stepByNum.has(input.by)) throw new WriteError("not-found", `step ${input.by} not found`, "the row in force is written first (specs-bot answer)");
  if (input.by <= input.num) throw new WriteError("invalid", `a row is superseded by a later one: ${input.by} ≤ ${input.num}`);
  const kind = input.kind[0]!.toUpperCase() + input.kind.slice(1);
  const rule = `${kind} by ${input.by} (the later row in force, 730); the text as decided: ${row.rule}`;
  const steps = [...model.steps.lines];
  steps[row.line] = joinRow([row.raw.num, row.raw.id, ` ${rule} `, row.raw.binds, row.raw.cell]);
  return {
    op: "supersede",
    refs: [`step ${input.num}`],
    message: `spec: row ${input.num} ${input.kind} by ${input.by}`,
    summary: `step ${input.num} ${input.kind} by ${input.by}`,
    changes: [{ path: STEPS, before: model.steps.lines.join("\n"), after: steps.join("\n") }],
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
  return {
    op: "retired.add",
    refs: [`retired ${input.retired}`],
    message: `spec: retired ${input.retired} → ${input.replacedBy}`,
    summary: `retire ${input.retired} (${area})`,
    changes: [{ path: RETIRED, before: model.retired.lines.join("\n"), after: lines.join("\n") }],
  };
}

