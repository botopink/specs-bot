// The milestone's status, after fronts-move.ts's migration dissolved `milestone/status.md` into each front's own
// README's `---status` companion (packages/site/src/progress.ts's TEMPORARY comment describes both layouts side
// by side). A companion keeps status.md's shape verbatim: `## <lane>` sections (`L1` … `L5`, `Done`), `###
// <heading>` groupings under a lane (several item lines each — a `###` is never one step alone), and bare
// `- [ ]` / `- [x]` items directly under a lane with no `###` at all (the old L5 lane's shape, carried over as-is).
// A "step" (`150 s29`, `144 B-137`) is only the start of an item line's text, inside whichever `###` (or bare
// lane) holds it: there is no section to address by anchor the way doc.ts's Section is, so this module reads and
// writes one item at a time, by its label, instead.
import { etagOf } from "../write/plan.ts";
import { type Doc } from "./doc.ts";

/** The front README's own `---status` companion ref, from any ref form that names the README itself. */
export function statusRef(ref: string): string {
  return ref.endsWith("---status") ? ref : `${ref}---status`;
}

export interface StatusItem {
  /** The `##` heading in force when the line appears, whole ("L1 — finish what is already on `feat`"). */
  lane: string;
  /** The `###` heading in force, or "" when the item sits directly under its lane with no subheading. */
  heading: string;
  /** The item's recognizable prefix ("150 s29", "144 B-137", "810-d") — statusLabel()'s label half. */
  label: string;
  /** What the line says after the label — statusLabel()'s rest half. */
  text: string;
  checked: boolean;
  /** The checkbox line's index in the document's lines; an indented continuation line, if any, follows it. */
  line: number;
  /** Covers the checkbox line and any indented continuation lines right below it. */
  etag: string;
}

const BOX = /^[-*] \[([ xX])\]\s+(.*)$/;

/**
 * An item's text split into its recognizable prefix and the rest — the same split
 * packages/site/src/progress.ts's statusItems() has always made to label a status item; both read it from here so
 * neither drifts from the other.
 */
export function statusLabel(text: string): { label: string; rest: string } {
  const [head, ...more] = text.split(" — ");
  const label = head!.length <= 60 ? head! : `${head!.slice(0, 57)}…`;
  return { label, rest: more.join(" — ") };
}

/** The line right after `start`'s continuation block: the first line that is not indented (blank or not). */
export function statusBlockEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end]!)) end++;
  return end;
}

/** Every item of a `---status` companion (or any document shaped like one), lane and heading tracked as read. */
export function parseStatusItems(doc: Doc): StatusItem[] {
  const out: StatusItem[] = [];
  const headingAt = new Map(doc.sections.map((s) => [s.start, s]));
  let lane = "";
  let heading = "";
  doc.lines.forEach((line, i) => {
    const s = headingAt.get(i);
    if (s) {
      if (s.level === 2) {
        lane = s.heading;
        heading = "";
      } else if (s.level === 3) {
        heading = s.heading;
      }
      return;
    }
    const b = line.match(BOX);
    if (!b || !lane) return;
    const { label, rest } = statusLabel(b[2]!);
    const end = statusBlockEnd(doc.lines, i);
    out.push({ lane, heading, label, text: rest, checked: b[1] !== " ", line: i, etag: etagOf(doc.lines.slice(i, end).join("\n")) });
  });
  return out;
}

/**
 * The first item whose label matches exactly (never a prefix). More than one item sharing a label is possible —
 * the file states no rule against it — so this is the first one in document order; a caller that means a later
 * one disambiguates by lane/heading itself, reading the list.
 */
export function findStatusItem(doc: Doc, label: string): StatusItem | undefined {
  return parseStatusItems(doc).find((i) => i.label === label);
}
