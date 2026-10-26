// `// LANGUAGE GAP` markers in the spec examples (`.bp` in a folder of the current milestone) against the
// `## Marker index` of milestone/language-gaps.md — the part of botopink's language-gap-markers check that reads
// spec files, kept here once the specs left the projects repository (PLAN.md § 6). Index paths are written from
// the data root (`specs/150-rakun/…/x.bp`).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Finding } from "./check.ts";
import { MILESTONE_DIR } from "./docs/load.ts";
import type { Store } from "./store.ts";

const MARK = "// LANGUAGE GAP";

export interface IndexRow {
  path: string;
  count: number;
  gaps: string[];
}

export function markerIndex(text: string): { rows: IndexRow[]; gapTitles: Set<string>; hasIndex: boolean } {
  const rows: IndexRow[] = [];
  const gapTitles = new Set<string>();
  let inIndex = false;
  let hasIndex = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      inIndex = line.startsWith("## Marker index");
      hasIndex ||= inIndex;
      continue;
    }
    const idx = inIndex && line.match(/^\| `([^`]+\.bp)` \| ([^|]*) \| (.*?) \|?$/);
    if (idx) {
      rows.push({ path: idx[1]!, count: Number(idx[2]!.replace(/\D/g, "")), gaps: [...idx[3]!.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!) });
    } else if (!inIndex) {
      const g = line.match(/^\| \*\*(.+?)\*\*/);
      if (g) gapTitles.add(g[1]!);
    }
  }
  return { rows, gapTitles, hasIndex };
}

function* bpFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* bpFiles(p);
    else if (e.name.endsWith(".bp")) yield p;
  }
}

export function checkGapMarkers(store: Store): Finding[] {
  const current = store.tree.current;
  const gapsDoc = store.tree.docs.find((d) => d.ref === `${MILESTONE_DIR}/language-gaps`);
  if (!gapsDoc) return [];
  const about = gapsDoc.ref;
  const { rows, gapTitles, hasIndex } = markerIndex(gapsDoc.lines.join("\n"));
  const out: Finding[] = [];
  const err = (code: string, message: string): Finding => ({ code, severity: "error", about, message });
  if (!hasIndex) return [err("gaps-no-index", "language-gaps.md has no `## Marker index` section")];

  const dataRoot = join(store.specsDir, "..");
  const counts = new Map<string, number>();
  for (const file of bpFiles(store.specsDir)) {
    // Closed milestones' examples keep their markers as they were written.
    if (store.tree.placeOf(relative(store.specsDir, file)).version !== current) continue;
    const n = readFileSync(file, "utf8").split("\n").filter((l) => l.includes(MARK)).length;
    if (n) counts.set(relative(dataRoot, file), n);
  }
  const specRows = rows.filter((r) => r.path.startsWith("specs/") && store.tree.placeOf(r.path.slice("specs/".length)).version === current);
  for (const r of specRows) {
    const n = counts.get(r.path);
    if (n === undefined) out.push(err("gaps-stale-row", `${r.path} holds no marker; delete its index row`));
    else if (n !== r.count) out.push(err("gaps-count", `${r.path} holds ${n} marker(s), its index row says ${r.count}`));
    for (const g of r.gaps) if (!gapTitles.has(g)) out.push(err("gaps-unknown-row", `${r.path} names **${g}**, which the tables no longer hold`));
  }
  const indexed = new Set(specRows.map((r) => r.path));
  for (const [path, n] of counts) {
    if (!indexed.has(path)) out.push(err("gaps-no-row", `${path} holds ${n} marker(s) and has no index row`));
  }
  return out;
}
