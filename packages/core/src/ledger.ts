// decisions-taken/ as a virtual decisions-taken-steps.md — moved here from packages/api/src/routes.ts (front:
// the decisions-record-split piece that writes scripts/split-record.ts) so a script outside the api package
// (no server, no Hono) can call it for its own round-trip oracle without importing the api package's routes.
import { formatStepRow } from "./decisions/steps.ts";
import type { Model } from "./model.ts";

/**
 * Recreates the virtual `decisions-taken-steps.md` the old flat-file layout once held — byte-compatible with
 * what `decisions/steps.ts`'s `parseSteps` already reads: a title, the stated next-free number, then one `##
 * <slug>` heading per group (`model.record.readme.order`, store.ts's loadRecord), its Record table and rows.
 *
 * The heading carries the bare slug alone, never "<slug> — <summary>": `store.ts`'s loadRecord rewrites every
 * row's `section` to the group's bare slug (never its "slug — summary" form), so a round trip through
 * `parseSteps` (which takes a row's section from the nearest `## ` heading verbatim) only reproduces
 * `model.steps.rows` exactly when the heading is the bare slug. A group's summary is already one call away
 * (`GET /api/subjects/:slug`), so dropping it here costs nothing a reader cannot get elsewhere.
 */
export function renderLedger(model: Model): string {
  const { readme, groups } = model.record;
  const lines = ["# Decisions taken — the steps", "", `The record. **The next free number is ${model.nextFree}.**`];
  for (const slug of readme.order) {
    const group = groups.get(slug);
    if (!group) continue; // group-missing: check.ts's to report, not renderLedger's to fail over.
    const rows = [...group.rows].sort((a, b) => a.num - b.num);
    lines.push("", `## ${slug}`, "", "| # | Id | Rule in force | Binds | Cell |", "|---|---|---|---|---|", ...rows.map((r) => formatStepRow(r)));
  }
  return lines.join("\n");
}
