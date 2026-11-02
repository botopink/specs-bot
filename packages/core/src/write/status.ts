// Status writes (PLAN.md § 5.2): change one item of a front README's `---status` companion — check it, add a
// note, or move it into `## Landed` — without reformatting anything else in the file (docs/status.ts § the shape).
import { type Doc } from "../docs/doc.ts";
import { findStatusItem, statusBlockEnd, statusRef } from "../docs/status.ts";
import { docAt, type Model } from "../model.ts";
import { etagOf, type Plan, WriteError } from "./plan.ts";

const pathOf = (ref: string) => `specs/${ref}.md`;

const LANDED_HEADING = "## Landed";

/**
 * `statusRef(ref)`'s document, or the clearest reason it is missing: the ref itself never existed, its front is
 * in a closed milestone (no migration ever gave it a companion), or the companion specifically is missing even
 * though the ref's own document is right there in the current milestone (the real "not found" case).
 */
function statusDocFor(model: Model, ref: string): Doc {
  const sref = statusRef(ref);
  const doc = docAt(model, sref);
  if (doc) {
    if (doc.version !== model.tree.current) {
      throw new WriteError("frozen", `${doc.ref} is in ${doc.version}, a closed milestone`, `only ${model.tree.current} is written`);
    }
    return doc;
  }
  const original = docAt(model, ref);
  if (original && original.version !== model.tree.current) {
    throw new WriteError(
      "not-found",
      `${sref} not found`,
      `${original.ref} is in ${original.version}, a closed milestone: only ${model.tree.current}'s fronts have a ---status companion`,
    );
  }
  if (original) throw new WriteError("not-found", `${sref} not found`, `${original.ref} has no ---status companion yet`);
  throw new WriteError("not-found", `${sref} not found`, "specs-bot doc / specs-bot fronts to find the right ref");
}

export interface StatusSetInput {
  ref: string;
  /** The item's label, exactly as findStatusItem reads it (docs/status.ts: the first match, document order). */
  label: string;
  /** true checks the box, false unchecks it; omitted leaves it as it was. */
  check?: boolean;
  /** A continuation line added right below the item (and below a landed item's new continuation, if any). */
  note?: string;
  /** Moves the item (and its continuation lines) into `## Landed`, created at the file's end if it has none yet. */
  landed?: boolean;
  etag?: string;
}

/** The text's lines without trailing blank lines; refuses an empty note. */
function noteLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  if (!lines.join("").trim()) throw new WriteError("invalid", "the note is empty");
  return lines.map((l) => `  ${l.trim()}`);
}

export function statusSet(model: Model, input: StatusSetInput, _party: string): Plan {
  const doc = statusDocFor(model, input.ref);
  const item = findStatusItem(doc, input.label);
  if (!item) throw new WriteError("not-found", `no item "${input.label}" in ${doc.ref}`, `specs-bot status ${doc.ref} lists the items`);
  if (input.etag !== undefined && input.etag !== item.etag) {
    throw new WriteError("conflict", `item ${item.label} of ${doc.ref} changed since it was read`, "read it again and redo the edit over it", { etag: item.etag });
  }
  if (input.check === undefined && input.note === undefined && !input.landed) {
    throw new WriteError("invalid", "nothing to change: give check, note or landed");
  }

  let lines = [...doc.lines];
  if (input.check !== undefined) {
    lines[item.line] = lines[item.line]!.replace(/^(\s*[-*] )\[[ xX]\]/, `$1[${input.check ? "x" : " "}]`);
  }

  let end = statusBlockEnd(lines, item.line);
  if (input.note !== undefined) {
    const added = noteLines(input.note);
    lines.splice(end, 0, ...added);
    end += added.length;
  }

  const what = [
    ...(input.check !== undefined ? [input.check ? "checked" : "unchecked"] : []),
    ...(input.note !== undefined ? ["note added"] : []),
    ...(input.landed ? ["moved to Landed"] : []),
  ];

  if (input.landed) {
    let start = item.line;
    const block = lines.slice(start, end);
    // The blank line before the block goes with it, so the lane keeps one blank line between its remaining items
    // (the same trick write/decisions.ts's pendingWithdraw uses for the pending page).
    if (start > 0 && lines[start - 1]!.trim() === "" && (lines[end] ?? "").trim() === "") start--;
    lines = appendToLanded([...lines.slice(0, start), ...lines.slice(end)], block);
  }

  return {
    op: "status.set",
    refs: [`${doc.ref}#${item.label}`],
    message: `spec(${doc.version}): ${shortRef(doc)}: ${item.label} ${what.join(", ")}`,
    summary: `${item.label} of ${doc.ref}: ${what.join(", ")}`,
    changes: [{ path: pathOf(doc.ref), before: doc.lines.join("\n"), after: lines.join("\n") }],
  };
}

/** Adds `block` at the end of `## Landed` — a new section at the file's end when the document has none yet. */
function appendToLanded(lines: string[], block: string[]): string[] {
  const idx = lines.findIndex((l) => l.trim() === LANDED_HEADING);
  if (idx === -1) {
    let at = lines.length;
    while (at > 0 && lines[at - 1]!.trim() === "") at--;
    return [...lines.slice(0, at), "", LANDED_HEADING, "", ...block, ""];
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  while (end > idx + 1 && lines[end - 1]!.trim() === "") end--;
  const prev = lines[end - 1] ?? "";
  // Two checklist items join with no blank line between them, the way status.md's own items always have.
  const joins = /^\s*[-*] \[/.test(block[0]!) && /^\s*[-*] \[/.test(prev);
  const insert = joins ? block : ["", ...block];
  return [...lines.slice(0, end), ...insert, ...lines.slice(end)];
}

/** "150-rakun/README" — the last two parts of a ref, for commit subjects (write/doc.ts's shortRef, same shape). */
function shortRef(doc: Doc): string {
  return doc.ref.split("/").slice(-2).join("/");
}
