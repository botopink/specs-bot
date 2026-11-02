#!/usr/bin/env bun
// Moves every numbered front folder of specs/ under specs/fronts/, and dissolves milestone/status.md and
// milestone/fronts.md into the fronts' `README---status.md` companions and two new milestone pages (the
// maintainer, "fronts-move").
//
//   bun scripts/fronts-move.ts dry-run --specs-data <specs-data checkout> [--override <file.json | json>] [--all-milestones]
//   bun scripts/fronts-move.ts migrate --specs-data <specs-data checkout> [--override <file.json | json>] [--all-milestones]
//
// Phase 1 — move. `specs/<NNN-slug>/` → `specs/fronts/<NNN-slug>/`. `specs/milestone/` stays where it is (the
// maintainer: it is not a front), with one named exception: `milestone/review-triage.md` (a triage of the record's
// own rows, keyed by decision, not by front) goes to the root, `specs/review-triage.md`, beside
// decisions-pending.md and retired.md. Root files and decisions-taken/ stay. Then, in every markdown file of
// specs/:
//   - each relative link is re-resolved: the file it named before (moved or not) is the file it names after, from
//     the link's new place. A link that still resolves is left exactly as written; one that no longer does is
//     rewritten as the shortest relative path (anchor and query kept). Fronts went one level down and milestone/
//     did not, so every link between a front and the milestone gains (or loses) a `../`;
//   - a literal `specs/<NNN-slug>/` mention (prose, inline code, a fenced block — language-gaps.md's Marker index)
//     becomes `specs/fronts/<NNN-slug>/`, and `specs/milestone/review-triage` becomes `specs/review-triage`;
//   - moved.json (beside specs/) gains `<old ref> → <new ref>` for every moved document, and every chain in it is
//     collapsed (a value that is itself a key points straight at that key's final value);
//   - each eligible document (inside a moved front folder, outside /examples/, its name not already ending in
//     `---status`, of the current milestone unless --all-milestones) gets a `<name>---status.md` companion holding
//     only `---\nmilestone: <v>\n---\n# <its H1> — status\n`. A companion that would overwrite a file is refused.
//
// Phase 2 — relocate milestone/status.md and milestone/fronts.md.
//   status.md: lanes `## L1 …` … `## Done …`, each holding `### <heading>` sections of `- [ ]` / `- [x]` items.
//   Each `###` heading is cut at its first ` — ` or ` (` and split on ` · `; each part `<N> <words>` names the
//   front folder `<N>-<words joined by ->` of the current milestone, a bare `<N>` the one folder with that number
//   when only one has it.
//     1. one part, one folder → every line of the section goes to that front's README---status.md, under its
//        lane's `##` and its own `###` (both repeated as written).
//     2. several parts, each a folder (`151 json · 152 yaml · 158 markdown`) → each item (its `- [ ]` line and its
//        indented continuation lines) goes by the number it opens with: status.md's items name their front first
//        (`- [ ] 150 s29 — …`, `- [ ] 144 B-137 — …`); an item whose leading number is none of the heading's
//        fronts (the real one: `- [ ] 142 (396) — …`, 142 an old track id) and any prose line go to the global
//        file under the same lane and heading.
//     3. a heading that names a number but no single folder (the four `144 — …` headings: 144 has three folders)
//        is ambiguous: --override maps its exact text to a folder (or to "global"); without one it goes to the
//        global file, dry-run lists it and migrate refuses.
//     4. the intro under the H1, each lane's preamble, a heading that names no front number at all (`First —`,
//        `Second —`, `Across fronts — …`), and the whole `## L5` lane go to the global file.
//   The global file of status.md is milestone/order.md (moved.json: milestone/status → milestone/order).
//   fronts.md: the intro and every `##` section but `## Execution order` go, verbatim and in order, to
//   milestone/rules.md. `## Execution order` goes to milestone/order.md, except the rows of its
//   `| Front | Needs | Unblocks |` table whose old id (`**04**`, `**102** s3`) resolves to exactly one current
//   front folder through the alias tables (below): those go, under the table's header, to a
//   `## Execution order (from fronts.md, old ids)` section of that front's README---status.md. --override maps an
//   old id to a folder (or "global") as well.
//   Alias tables: the `| Old id | Step here |` table of each current front's README (the shape
//   botopink/projects' scripts/decisions-split.ts loadAliases reads): the first cell, backticks dropped, opens
//   with an old front name (`04-rakun-erlang-runtime` s2); its leading number ("04", as written) is the old id,
//   and the README's folder holds it. An id two folders hold is ambiguous, one no folder holds is unknown.
//   Inside a relocated line the only edit is a relative link's target, re-resolved from the line's new file; a
//   link to status.md or fronts.md themselves follows moved.json (to order.md, and to rules.md unless its anchor
//   is one of the Execution order's own sections, then order.md).
//
// --override: a JSON object (inline, or a file holding it) whose keys are a status.md `###` heading's exact text
// or a fronts.md old id, and whose values are a current front folder (`144-checker`) or "global".
//
// dry-run computes both phases and runs the fourteen oracles (O1–O7 over phase 1, S1–S7 over the result) and
// writes nothing. migrate runs the same and writes only when every oracle passes and no heading is ambiguous: with
// `.git` at the checkout's root, `git rm` + `git add` and one commit; without, a plain rename.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { check, type Finding } from "../packages/core/src/check.ts";
import { type Doc, FRONTS_DIR, parseDoc } from "../packages/core/src/docs/doc.ts";
import { MILESTONE_DIR, placeDocs } from "../packages/core/src/docs/load.ts";
import { type Meta, metaLines, splitMeta } from "../packages/core/src/docs/meta.ts";
import { type Front, frontsOf } from "../packages/core/src/model.ts";
import { loadStore } from "../packages/core/src/store.ts";
import { git } from "../packages/core/src/write/git.ts";
import { statusItems } from "../packages/site/src/progress.ts";

// ── the data, in memory ──

/** A specs-data checkout's content: every file under specs/ (path relative to specs/) and moved.json. */
export interface DataSet {
  specs: Map<string, Buffer>;
  /** moved.json's entries; undefined when the file does not exist. */
  moved?: Map<string, string>;
}

export const STATUS = `${MILESTONE_DIR}/status.md`;
export const FRONTS_MD = `${MILESTONE_DIR}/fronts.md`;
export const ORDER = `${MILESTONE_DIR}/order.md`;
export const RULES = `${MILESTONE_DIR}/rules.md`;
export const REVIEW_TRIAGE = `${MILESTONE_DIR}/review-triage.md`;
const COMPANION = "---status";
const NUMBERED = /^\d+-[a-z0-9][a-z0-9-]*$/;
const GLOBAL = "global";

const isMd = (p: string) => p.endsWith(".md");
const txt = (b: Buffer | undefined) => (b ? b.toString("utf8") : "");
const buf = (s: string) => Buffer.from(s, "utf8");
const refOf = (p: string) => p.replace(/\.md$/, "");
const isPermalink = (v: string) => /^https?:/.test(v);
/** A Doc of the spec tree: a .md under a folder of specs/, decisions-taken/ aside (load.ts's rule). */
const isTreeDoc = (p: string) => isMd(p) && p.includes("/") && !p.startsWith("decisions-taken/");

export function readDataSet(specsData: string): DataSet {
  const specsDir = join(specsData, "specs");
  const specs = new Map<string, Buffer>();
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), p);
      else if (e.isFile()) specs.set(p, readFileSync(join(dir, e.name)));
    }
  };
  walk(specsDir, "");
  const movedFile = join(specsData, "moved.json");
  const out: DataSet = { specs };
  if (existsSync(movedFile)) out.moved = new Map(Object.entries(JSON.parse(readFileSync(movedFile, "utf8")) as Record<string, string>));
  return out;
}

/** The numbered folders directly under specs/ (each holds at least one file). */
export function frontDirsOf(specs: Map<string, Buffer>): Set<string> {
  const out = new Set<string>();
  for (const p of specs.keys()) {
    const parts = p.split("/");
    if (parts.length >= 2 && NUMBERED.test(parts[0]!)) out.add(parts[0]!);
  }
  return out;
}

/** A path or a ref under specs/, where phase 1 puts it. */
export function phase1Path(p: string, dirs: Set<string>): string {
  if (p === REVIEW_TRIAGE || p === refOf(REVIEW_TRIAGE)) return p.slice(MILESTONE_DIR.length + 1);
  const top = p.split("/")[0]!;
  return dirs.has(top) ? `${FRONTS_DIR}/${p}` : p;
}

// ── links ──

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LINK = /\]\(([^)\s]+)\)/g;
const CODE = /(`+)[^`]*?\1/g;
// check.ts's EXTERNAL: a web link, an anchor, an absolute path is not a spec link.
const EXTERNAL = /^(https?:|mailto:|#|\/)/;
const ROOT = "/D";

/** Maps a target under specs/ (path relative to specs/, its anchor) to the file it names now. */
/** `after` is the text that follows the link on its line (fronts.md's "§ Execution order" names a section in prose). */
export type TargetMap = (specsPath: string, anchor: string, after?: string) => string;

/** The file a link names, as a path from the data root's parent (`/D/specs/…`, `/D/repository/…`). */
function resolveLink(fromFile: string, raw: string): { abs: string; decoded: string; suffix: string } {
  const cut = raw.search(/[#?]/);
  const path = cut < 0 ? raw : raw.slice(0, cut);
  const suffix = cut < 0 ? "" : raw.slice(cut);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {}
  const abs = posix.normalize(posix.join(ROOT, "specs", posix.dirname(fromFile), decoded || "."));
  return { abs, decoded, suffix };
}

/** The final file a link written in `fromFile` names, after `map`. */
export function finalTarget(fromFile: string, raw: string, map: TargetMap, after = ""): string {
  const { abs, suffix } = resolveLink(fromFile, raw);
  const specsRoot = `${ROOT}/specs/`;
  if (!abs.startsWith(specsRoot)) return abs;
  const anchor = suffix.startsWith("#") ? suffix.slice(1) : "";
  return `${specsRoot}${map(abs.slice(specsRoot.length), anchor, after)}`;
}

/** `raw` (written in `fromOld`), rewritten to name the same final file from `fromNew`; unchanged when it still does. */
export function rebaseLink(raw: string, fromOld: string, fromNew: string, map: TargetMap, after = ""): string {
  if (EXTERNAL.test(raw)) return raw;
  const want = finalTarget(fromOld, raw, map, after);
  const { abs: now, decoded, suffix } = resolveLink(fromNew, raw);
  if (now === want) return raw;
  let rel = posix.relative(posix.join(ROOT, "specs", posix.dirname(fromNew)), want) || ".";
  if (decoded.endsWith("/") && !rel.endsWith("/")) rel += "/";
  if (raw.includes("%")) rel = encodeURI(rel);
  return rel + suffix;
}

/**
 * A line's links and text, rewritten: `link` sees each link target outside fenced blocks and inline code (the
 * links doc.ts's linksOf reads), `text` every other stretch of the line, code included.
 */
type LinkFn = (raw: string, after: string) => string;

function rewriteLine(line: string, inFence: boolean, link: LinkFn, text: (s: string) => string): string {
  if (inFence) return text(line);
  let out = "";
  let at = 0;
  let base = 0;
  const prose = (seg: string) => {
    let o = "";
    let k = 0;
    for (const m of seg.matchAll(LINK)) {
      o += text(seg.slice(k, m.index! + 2)) + link(m[1]!, line.slice(base + m.index! + m[0].length)) + ")";
      k = m.index! + m[0].length;
    }
    return o + text(seg.slice(k));
  };
  for (const m of line.matchAll(CODE)) {
    base = at;
    out += prose(line.slice(at, m.index!)) + text(m[0]);
    at = m.index! + m[0].length;
  }
  base = at;
  return out + prose(line.slice(at));
}

/** Applies rewriteLine over a document's lines, fence-aware; returns the new lines and the indices that changed. */
export function rewriteLines(lines: string[], link: LinkFn, text: (s: string) => string = (s) => s): { lines: string[]; changed: number[] } {
  const out: string[] = [];
  const changed: number[] = [];
  let fence: string | undefined;
  lines.forEach((line, i) => {
    const f = line.match(FENCE);
    let next: string;
    if (f) {
      if (!fence) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (line.trimStart().startsWith(fence)) fence = undefined;
      next = text(line);
    } else next = rewriteLine(line, fence !== undefined, link, text);
    if (next !== line) changed.push(i);
    out.push(next);
  });
  return { lines: out, changed };
}

/** Every link target of a document, in order (the same scan rewriteLines makes). */
export function linkTargets(lines: string[]): string[] {
  const out: string[] = [];
  rewriteLines(lines, (raw) => {
    out.push(raw);
    return raw;
  });
  return out;
}

/** The text a line normalizes to for comparison: each relative link's target replaced by the final file it names. */
function normalizeLinks(lines: string[], fromFile: string, map: TargetMap): string[] {
  return rewriteLines(lines, (raw, after) => (EXTERNAL.test(raw) ? raw : `<${finalTarget(fromFile, raw, map, after).slice(ROOT.length + 1)}>`)).lines;
}

// ── phase 1 ──

export interface Phase1 {
  dirs: Set<string>;
  /** old path → new path, every file that moved (review-triage.md included). */
  moves: Map<string, string>;
  specs: Map<string, Buffer>;
  moved: Map<string, string>;
  /** new path → the line indices phase 1 rewrote in it. */
  rewritten: Map<string, number[]>;
  /** How many link targets were rewritten, and how many of those cross between a front and milestone/. */
  links: { total: number; frontMilestone: number };
  /** new companion paths. */
  companions: string[];
  /** Companions that would overwrite an existing file. */
  collisions: string[];
}

function textRewriter(dirs: Set<string>): (s: string) => string {
  const names = [...dirs].map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const front = names.length ? new RegExp(`(?<![\\w-])specs/(${names.join("|")})/`, "g") : undefined;
  const triage = new RegExp(`(?<![\\w-])specs/${refOf(REVIEW_TRIAGE)}(?![\\w-])`, "g");
  return (s) => {
    let o = s.replace(triage, `specs/${refOf(REVIEW_TRIAGE).slice(MILESTONE_DIR.length + 1)}`);
    if (front) o = o.replace(front, `specs/${FRONTS_DIR}/$1/`);
    return o;
  };
}

const inFront = (p: string) => p.startsWith(`${FRONTS_DIR}/`);
const inMilestone = (p: string) => p.startsWith(`${MILESTONE_DIR}/`);

/** Docs of a file set, placed (version and owner) the way load.ts places them. */
function docsOf(specs: Map<string, Buffer>, pathOf: (p: string) => string = (p) => p): Doc[] {
  const docs: Doc[] = [];
  for (const [p, b] of specs) {
    const at = pathOf(p);
    if (isTreeDoc(at)) docs.push(parseDoc(at, txt(b)));
  }
  placeDocs(docs);
  return docs;
}

function currentOf(docs: Doc[]): string {
  return placeDocs(docs).current;
}

/** Whether a document gets a companion (phase 1's rule; S4 recomputes it from the result). */
function eligible(d: Doc, dirs: Set<string>, current: string, all: boolean): boolean {
  const top = d.ref.split("/");
  return top[0] === FRONTS_DIR && dirs.has(top[1] ?? "") && !d.ref.includes("/examples/") && !d.name.endsWith(COMPANION) && (all || d.version === current);
}

export function companionText(d: Doc): string {
  return `---\nmilestone: ${d.version}\n---\n# ${d.title} — status\n`;
}

export function collapse(moved: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v0] of moved) {
    let v = v0;
    const seen = new Set([k]);
    while (moved.has(v) && !seen.has(v)) {
      seen.add(v);
      v = moved.get(v)!;
    }
    out.set(k, v);
  }
  return out;
}

export function planPhase1(data: DataSet, allMilestones = false): Phase1 {
  const dirs = frontDirsOf(data.specs);
  const moves = new Map<string, string>();
  for (const p of data.specs.keys()) {
    const np = phase1Path(p, dirs);
    if (np !== p) moves.set(p, np);
  }
  const map: TargetMap = (t) => phase1Path(t, dirs);
  const text = textRewriter(dirs);
  const specs = new Map<string, Buffer>();
  const rewritten = new Map<string, number[]>();
  const links = { total: 0, frontMilestone: 0 };
  for (const [p, b] of data.specs) {
    const np = moves.get(p) ?? p;
    if (!isMd(p)) {
      specs.set(np, b);
      continue;
    }
    const r = rewriteLines(
      txt(b).split("\n"),
      (raw) => {
        const out = rebaseLink(raw, p, np, map);
        if (out !== raw) {
          links.total++;
          const target = finalTarget(p, raw, map).slice(`${ROOT}/specs/`.length);
          if ((inFront(np) && inMilestone(target)) || (inMilestone(np) && inFront(target))) links.frontMilestone++;
        }
        return out;
      },
      text,
    );
    if (r.changed.length) {
      rewritten.set(np, r.changed);
      specs.set(np, buf(r.lines.join("\n")));
    } else specs.set(np, b);
  }

  // moved.json: every old value re-pointed, every moved doc's old ref added, then the chains collapsed.
  const moved = new Map<string, string>();
  for (const [k, v] of data.moved ?? []) moved.set(k, isPermalink(v) ? v : phase1Path(v, dirs));
  for (const [p, np] of moves) if (isMd(p)) moved.set(refOf(p), refOf(np));

  const docs = docsOf(specs);
  const current = currentOf(docs);
  const companions: string[] = [];
  const collisions: string[] = [];
  for (const d of docs) {
    if (!eligible(d, dirs, current, allMilestones)) continue;
    const cp = `${d.ref}${COMPANION}.md`;
    if (specs.has(cp)) {
      collisions.push(cp);
      continue;
    }
    specs.set(cp, buf(companionText(d)));
    companions.push(cp);
  }
  return { dirs, moves, specs, moved: collapse(moved), rewritten, links, companions, collisions };
}

// ── phase 2 ──

export interface HeadingRoute {
  heading: string;
  lane: string;
  /** "front" (rule 1), "multi" (rule 2), "global" (rule 4), "ambiguous" (rule 3), "override" (rule 3, resolved). */
  rule: "front" | "multi" | "global" | "ambiguous" | "override";
  /** The folder(s) it goes to; empty for global. */
  dirs: string[];
  why?: string;
}

export interface IdRoute {
  id: string;
  row: string;
  kind: "resolved" | "ambiguous" | "unknown" | "override";
  dir?: string;
  holders: string[];
}

export interface Phase2Counts {
  /** status.md items (box lines) by the rule that placed them. */
  items: { front: number; multi: number; override: number; ambiguous: number; global: number; multiGlobal: number };
  ids: { resolved: number; ambiguous: number; unknown: number; override: number };
}

export interface Phase2 {
  specs: Map<string, Buffer>;
  moved: Map<string, string>;
  headings: HeadingRoute[];
  ids: IdRoute[];
  /** Headings that need an --override before migrate writes. */
  ambiguous: HeadingRoute[];
  /** The companion paths phase 2 appended to. */
  touched: string[];
  counts: Phase2Counts;
  /** Lines rewritten (a link rebased) inside the relocated text, and in other documents linking to status/fronts.md. */
  relinked: number;
  /** Whether there was anything to relocate. */
  ran: boolean;
}

interface Chunk {
  dest: string;
  lane?: string;
  h3?: string;
  lines: string[];
}

type CurrentFront = { num: number; slug: string; dir: string };

function currentFronts(docs: Doc[]): CurrentFront[] {
  const current = currentOf(docs);
  return frontsOf(docs)
    .filter((f) => f.version === current)
    .map((f) => ({ num: f.num, slug: f.slug, dir: f.ref.split("/").at(-1)! }));
}

/** The folder a heading part (`150 rakun`, `98 packaging tail`, `144`) names, or why it names none. */
function partFolder(part: string, fronts: CurrentFront[]): { num?: number; dir?: string; why?: string } {
  const m = part.trim().match(/^(\d{1,3})(?:\s+(.+))?$/);
  if (!m) return {};
  const num = Number(m[1]);
  const withNum = fronts.filter((f) => f.num === num);
  if (m[2]) {
    const slug = m[2].trim().toLowerCase().replace(/\s+/g, "-");
    const hit = withNum.filter((f) => f.slug === slug);
    if (hit.length === 1) return { num, dir: hit[0]!.dir };
    return { num, why: `no folder ${num}-${slug} (${withNum.map((f) => f.dir).join(", ") || "no folder numbered " + num})` };
  }
  if (withNum.length === 1) return { num, dir: withNum[0]!.dir };
  return { num, why: withNum.length ? `${withNum.length} folders numbered ${num}: ${withNum.map((f) => f.dir).join(", ")}` : `no folder numbered ${num}` };
}

export function routeHeading(heading: string, lane: string, fronts: CurrentFront[], override: Map<string, string>): HeadingRoute & { byNum: Map<number, string> } {
  const byNum = new Map<number, string>();
  const forced = override.get(heading);
  if (forced !== undefined) {
    const dir = overrideDir(forced, fronts, `heading "${heading}"`);
    if (dir) byNum.set(fronts.find((f) => f.dir === dir)!.num, dir);
    return { heading, lane, rule: "override", dirs: dir ? [dir] : [], byNum };
  }
  if (laneOf(lane) === "L5") return { heading, lane, rule: "global", dirs: [], byNum };
  const head = heading.split(/ — | \(/)[0]!;
  const parts = head.split(" · ").map((p) => partFolder(p, fronts));
  const numbered = parts.filter((p) => p.num !== undefined);
  if (!numbered.length) return { heading, lane, rule: "global", dirs: [], byNum };
  const bad = numbered.find((p) => !p.dir);
  if (bad) return { heading, lane, rule: "ambiguous", dirs: [], why: bad.why!, byNum };
  for (const p of numbered) byNum.set(p.num!, p.dir!);
  const dirs = [...new Set(numbered.map((p) => p.dir!))];
  return { heading, lane, rule: dirs.length === 1 ? "front" : "multi", dirs, byNum };
}

function overrideDir(value: string, fronts: CurrentFront[], what: string): string | undefined {
  if (value === GLOBAL) return undefined;
  const dir = value.replace(/^fronts\//, "").replace(/\/+$/, "");
  if (!fronts.some((f) => f.dir === dir)) throw new Error(`--override: ${what} → ${value}, which is no current front folder (nor "global")`);
  return dir;
}

function laneOf(heading: string): string | undefined {
  return heading.match(/^(L\d+|Done)\b/)?.[1];
}

const BOX = /^[-*] \[[ xX]\]\s+/;
const BOX_NUM = /^[-*] \[[ xX]\]\s+\**(\d{1,3})\b/;
export const TABLE_HEAD = /^\|\s*Front\s*\|\s*Needs\s*\|\s*Unblocks\s*\|/;
const TABLE_DELIM = /^\|\s*:?-{3,}/;

/** old id ("04", as written) → the current front folders whose README's alias table holds it. */
export function aliasesOf(docs: Doc[], fronts: CurrentFront[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of fronts) {
    const readme = docs.find((d) => d.ref === `${FRONTS_DIR}/${f.dir}/README`);
    if (!readme) continue;
    let on = false;
    for (const ln of readme.lines) {
      if (ln.startsWith("| Old id")) {
        on = true;
        continue;
      }
      if (!on) continue;
      if (!ln.startsWith("|")) {
        on = false;
        continue;
      }
      if (ln.startsWith("|---")) continue;
      const cell = (ln.split("|")[1] ?? "").replaceAll("`", "").trim();
      const name = cell.match(/(\d+-[a-z0-9-]+)/)?.[1];
      if (!name) continue;
      const num = name.match(/^\d+/)![0];
      (out.get(num) ?? out.set(num, new Set()).get(num)!).add(f.dir);
    }
  }
  return out;
}

const trimBlank = (ls: string[]) => {
  let a = 0;
  let b = ls.length;
  while (a < b && ls[a]!.trim() === "") a++;
  while (b > a && ls[b - 1]!.trim() === "") b--;
  return ls.slice(a, b);
};

/** Chunks appended under their lane and heading, each repeated only when it changes. */
function emitChunks(chunks: Chunk[]): string[] {
  const out: string[] = [];
  let lane: string | undefined;
  let h3: string | undefined;
  // A heading just written wants a blank line before the first body line under it.
  let fresh = true;
  for (const c of chunks) {
    const body = trimBlank(c.lines);
    if (c.lane !== lane) {
      lane = c.lane;
      h3 = undefined;
      if (lane !== undefined) out.push("", `## ${lane}`);
      fresh = true;
    }
    if (c.h3 !== h3) {
      h3 = c.h3;
      if (h3 !== undefined) out.push("", `### ${h3}`);
      fresh = true;
    }
    if (!body.length) continue;
    if (fresh) out.push("");
    fresh = false;
    out.push(...body);
  }
  return out;
}

export function planPhase2(p1: Phase1, override: Map<string, string> = new Map()): Phase2 {
  const specs = new Map(p1.specs);
  const moved = new Map(p1.moved);
  const statusText = specs.has(STATUS) ? txt(specs.get(STATUS)) : undefined;
  const frontsText = specs.has(FRONTS_MD) ? txt(specs.get(FRONTS_MD)) : undefined;
  const counts: Phase2Counts = {
    items: { front: 0, multi: 0, override: 0, ambiguous: 0, global: 0, multiGlobal: 0 },
    ids: { resolved: 0, ambiguous: 0, unknown: 0, override: 0 },
  };
  if (statusText === undefined && frontsText === undefined) {
    return { specs, moved, headings: [], ids: [], ambiguous: [], touched: [], counts, relinked: 0, ran: false };
  }
  const docs = docsOf(specs);
  const current = currentOf(docs);
  const fronts = currentFronts(docs);

  // fronts.md's Execution order anchors: a link to one of them follows the section into order.md.
  const frontsDoc = frontsText !== undefined ? parseDoc(FRONTS_MD, frontsText) : undefined;
  const exec = frontsDoc?.sections.find((s) => s.level === 2 && s.heading === "Execution order");
  const execAnchors = new Set(frontsDoc && exec ? frontsDoc.sections.filter((s) => s.start >= exec.start && s.start < exec.end).map((s) => s.anchor) : []);
  const map = phase2Map(execAnchors);

  const chunks: Chunk[] = [];
  const push = (c: Chunk) => {
    const last = chunks.at(-1);
    if (last && last.dest === c.dest && last.lane === c.lane && last.h3 === c.h3) last.lines.push(...c.lines);
    else chunks.push(c);
  };
  const headings: HeadingRoute[] = [];
  let statusMeta: Meta = {};
  let statusIntro: string[] = [];

  if (statusText !== undefined) {
    const doc = parseDoc(STATUS, statusText);
    const { meta, end } = splitMeta(doc.lines);
    statusMeta = meta;
    const lines = doc.lines;
    const heads = doc.sections.filter((s) => s.level <= 3);
    const h1 = heads.find((s) => s.level === 1);
    const firstLane = heads.find((s) => s.level === 2);
    const introStart = h1 ? h1.start + 1 : end;
    statusIntro = lines.slice(introStart, firstLane ? firstLane.start : lines.length);
    if (h1 && h1.start > end) statusIntro = [...lines.slice(end, h1.start), ...statusIntro];
    for (const lane of heads.filter((s) => s.level === 2)) {
      const h3s = heads.filter((s) => s.level === 3 && s.start > lane.start && s.start < lane.end);
      push({ dest: GLOBAL, lane: lane.heading, lines: lines.slice(lane.start + 1, h3s[0]?.start ?? lane.end) });
      for (const h of h3s) {
        const route = routeHeading(h.heading, lane.heading, fronts, override);
        headings.push({ heading: route.heading, lane: route.lane, rule: route.rule, dirs: route.dirs, ...(route.why ? { why: route.why } : {}) });
        const body = lines.slice(h.start + 1, h.end);
        const boxes = body.filter((l) => BOX.test(l)).length;
        if (route.rule === "multi") {
          // Rule 2: each item by its own leading number; prose and an item no heading front opens stay global.
          let i = 0;
          while (i < body.length) {
            const l = body[i]!;
            if (BOX.test(l)) {
              let j = i + 1;
              while (j < body.length && body[j]!.trim() !== "" && /^\s/.test(body[j]!)) j++;
              const n = l.match(BOX_NUM)?.[1];
              const dir = n !== undefined ? route.byNum.get(Number(n)) : undefined;
              if (dir) counts.items.multi++;
              else counts.items.multiGlobal++;
              push({ dest: dir ?? GLOBAL, lane: lane.heading, h3: h.heading, lines: body.slice(i, j) });
              i = j;
            } else {
              push({ dest: GLOBAL, lane: lane.heading, h3: h.heading, lines: [l] });
              i++;
            }
          }
          continue;
        }
        const dest = route.dirs[0] ?? GLOBAL;
        if (route.rule === "front") counts.items.front += boxes;
        else if (route.rule === "override") counts.items.override += boxes;
        else if (route.rule === "ambiguous") counts.items.ambiguous += boxes;
        else counts.items.global += boxes;
        push({ dest, lane: lane.heading, h3: h.heading, lines: body });
      }
    }
    counts.items.global += statusIntro.filter((l) => BOX.test(l)).length;
    for (const c of chunks) if (c.dest === GLOBAL && c.h3 === undefined) counts.items.global += c.lines.filter((l) => BOX.test(l)).length;
  }

  // fronts.md
  const ids: IdRoute[] = [];
  const rowsFor = new Map<string, string[]>();
  let tableHead: string[] = [];
  let execLines: string[] = [];
  let rulesLines: string[] = [];
  let frontsMeta: Meta = {};
  if (frontsDoc) {
    const lines = frontsDoc.lines;
    const { meta, end } = splitMeta(lines);
    frontsMeta = meta;
    const h2s = frontsDoc.sections.filter((s) => s.level === 2);
    const h1 = frontsDoc.sections.find((s) => s.level === 1);
    rulesLines = [...lines.slice(end, h1 ? h1.start : end), ...lines.slice(h1 ? h1.start + 1 : end, h2s[0]?.start ?? lines.length)];
    for (const s of h2s) if (s !== exec) rulesLines.push(...lines.slice(s.start, s.end));
    if (exec) {
      const aliases = aliasesOf(docs, fronts);
      const body = lines.slice(exec.start + 1, exec.end);
      let inTable = false;
      for (let i = 0; i < body.length; i++) {
        const l = body[i]!;
        if (TABLE_HEAD.test(l)) {
          inTable = true;
          tableHead = [l];
          if (TABLE_DELIM.test(body[i + 1] ?? "")) tableHead.push(body[++i]!);
          execLines.push(...tableHead);
          continue;
        }
        if (inTable && !l.startsWith("|")) inTable = false;
        const id = inTable ? l.match(/^\|\s*\*\*([^*]+)\*\*/)?.[1]?.trim() : undefined;
        if (id === undefined) {
          execLines.push(l);
          continue;
        }
        const holders = [...(aliases.get(id) ?? [])].sort();
        let route: IdRoute;
        if (override.has(id)) {
          const dir = overrideDir(override.get(id)!, fronts, `old id ${id}`);
          route = { id, row: l, kind: "override", holders, ...(dir ? { dir } : {}) };
        } else if (holders.length === 1) route = { id, row: l, kind: "resolved", dir: holders[0]!, holders };
        else route = { id, row: l, kind: holders.length ? "ambiguous" : "unknown", holders };
        counts.ids[route.kind]++;
        ids.push(route);
        if (route.dir) (rowsFor.get(route.dir) ?? rowsFor.set(route.dir, []).get(route.dir)!).push(l);
        else execLines.push(l);
      }
    }
  }

  // Each destination's text, then the links of its relocated lines rebased from milestone/ to it.
  let relinked = 0;
  const rebase = (from: string, to: string, ls: string[]) => {
    const r = rewriteLines(ls, (raw, after) => rebaseLink(raw, from, to, map, after));
    relinked += r.changed.length;
    return r.lines;
  };
  const touched: string[] = [];
  const dests = new Set([...chunks.map((c) => c.dest), ...rowsFor.keys()]);
  dests.delete(GLOBAL);
  for (const dir of [...dests].sort()) {
    const path = `${FRONTS_DIR}/${dir}/README${COMPANION}.md`;
    let base = specs.has(path) ? txt(specs.get(path)) : undefined;
    if (base === undefined) {
      const readme = docs.find((d) => d.ref === `${FRONTS_DIR}/${dir}/README`);
      base = `---\nmilestone: ${readme?.version ?? current}\n---\n# ${readme?.title ?? dir} — status\n`;
    }
    const add = rebase(STATUS, path, emitChunks(chunks.filter((c) => c.dest === dir)));
    const rows = rowsFor.get(dir);
    if (rows) add.push("", "## Execution order (from fronts.md, old ids)", "", ...tableHead, ...rebase(FRONTS_MD, path, rows));
    specs.set(path, buf(`${[...base.replace(/\n+$/, "").split("\n"), ...add].join("\n")}\n`));
    touched.push(path);
  }

  if (statusText !== undefined || exec) {
    const meta: Meta = { ...frontsMeta, ...statusMeta };
    if (!meta.milestone) meta.milestone = current;
    const order = [...metaLines(withMilestoneFirst(meta)), "# Order", "", ...rebase(STATUS, ORDER, trimBlank(statusIntro))];
    if (exec) order.push("", "## Execution order", "", ...rebase(FRONTS_MD, ORDER, trimBlank(execLines)));
    order.push(...rebase(STATUS, ORDER, emitChunks(chunks.filter((c) => c.dest === GLOBAL && c.lane !== undefined))));
    specs.set(ORDER, buf(`${order.join("\n")}\n`));
  }
  if (frontsDoc) {
    const meta: Meta = { ...frontsMeta };
    if (!meta.milestone) meta.milestone = current;
    const rules = [...metaLines(withMilestoneFirst(meta)), "# Rules", "", ...rebase(FRONTS_MD, RULES, trimBlank(rulesLines))];
    specs.set(RULES, buf(`${rules.join("\n").replace(/\n+$/, "")}\n`));
  }
  specs.delete(STATUS);
  specs.delete(FRONTS_MD);

  // Every other document's link to status.md / fronts.md follows them.
  for (const [p, b] of specs) {
    if (!isMd(p) || p === ORDER || p === RULES || touched.includes(p)) continue;
    const r = rewriteLines(txt(b).split("\n"), (raw, after) => rebaseLink(raw, p, p, map, after));
    if (r.changed.length) {
      relinked += r.changed.length;
      specs.set(p, buf(r.lines.join("\n")));
    }
  }

  if (statusText !== undefined) moved.set(refOf(STATUS), refOf(ORDER));
  if (frontsText !== undefined) moved.set(refOf(FRONTS_MD), refOf(RULES));
  const finalMoved = collapse(moved);
  return { specs, moved: finalMoved, headings, ids, ambiguous: headings.filter((h) => h.rule === "ambiguous"), touched, counts, relinked, ran: true };
}

function withMilestoneFirst(meta: Meta): Meta {
  const { milestone, ...rest } = meta;
  return { ...(milestone !== undefined ? { milestone } : {}), ...rest };
}

/**
 * Phase 2's TargetMap: status.md → order.md; fronts.md → rules.md, or order.md when the link names one of the
 * Execution order's sections — by its anchor (`fronts.md#execution-order`), or, with no anchor, by the prose
 * right after it (`[`fronts.md`](fronts.md) § Execution order`, status.md's own way of citing it).
 */
export function phase2Map(execAnchors: Set<string>): TargetMap {
  return (t, anchor, after = "") => {
    if (t === STATUS) return ORDER;
    if (t !== FRONTS_MD) return t;
    if (anchor) return execAnchors.has(anchor) ? ORDER : RULES;
    return /^\s*§\s*(Execution order|Dependency graph)/.test(after) ? ORDER : RULES;
  };
}

// ── the whole plan ──

export interface Plan {
  before: DataSet;
  p1: Phase1;
  p2: Phase2;
  after: DataSet;
  allMilestones: boolean;
}

export function planMove(data: DataSet, override: Map<string, string> = new Map(), allMilestones = false): Plan {
  const p1 = planPhase1(data, allMilestones);
  const p2 = planPhase2(p1, override);
  return { before: data, p1, p2, after: { specs: p2.specs, moved: p2.moved }, allMilestones };
}

/** Nothing moves, nothing is relocated, moved.json stays as it is. */
export function nothingToDo(plan: Plan): boolean {
  return (
    plan.p1.moves.size === 0 &&
    plan.p1.companions.length === 0 &&
    plan.p1.rewritten.size === 0 &&
    !plan.p2.ran &&
    sameMap(plan.before.moved ?? new Map(), plan.after.moved ?? new Map())
  );
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

// ── oracles ──

export interface OracleResult {
  ok: boolean;
  detail: string;
}

const pass = (detail: string): OracleResult => ({ ok: true, detail });
const fail = (detail: string): OracleResult => ({ ok: false, detail });
const few = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join("; ")}; … (${xs.length} in all)` : xs.join("; "));

/** O1: every file is at its phase-1 place, nothing left in an old folder, bytes equal but the listed lines. */
export function oracleFilesMoved(plan: Plan): OracleResult {
  const { before, p1 } = plan;
  const problems: string[] = [];
  for (const [p, b] of before.specs) {
    const np = phase1Path(p, p1.dirs);
    const a = p1.specs.get(np);
    if (!a) {
      problems.push(`${p}: missing at ${np}`);
      continue;
    }
    const lines = p1.rewritten.get(np);
    if (!lines) {
      if (!a.equals(b)) problems.push(`${np}: bytes differ but no line is listed`);
      continue;
    }
    const x = txt(b).split("\n");
    const y = txt(a).split("\n");
    if (x.length !== y.length) {
      problems.push(`${np}: line count changed`);
      continue;
    }
    const diff = x.map((l, i) => (l !== y[i] ? i : -1)).filter((i) => i >= 0);
    if (JSON.stringify(diff) !== JSON.stringify(lines)) problems.push(`${np}: lines ${diff.join(",")} differ, listed ${lines.join(",")}`);
  }
  for (const p of p1.specs.keys()) {
    if (p1.dirs.has(p.split("/")[0]!)) problems.push(`${p}: left in an old folder`);
    if (p === REVIEW_TRIAGE) problems.push(`${p}: left in milestone/`);
  }
  const expected = new Set([...before.specs.keys()].map((p) => phase1Path(p, p1.dirs)));
  const extra = [...p1.specs.keys()].filter((p) => !expected.has(p) && !p1.companions.includes(p));
  if (extra.length) problems.push(`unexpected files: ${few(extra)}`);
  if (problems.length) return fail(few(problems));
  const lines = [...p1.rewritten.values()].reduce((n, l) => n + l.length, 0);
  return pass(`${before.specs.size} file(s) at their place (${p1.moves.size} moved); ${p1.rewritten.size} file(s) rewritten, ${lines} line(s), every other byte equal`);
}

/** The documents before, read at their phase-1 path (the reading a numbered folder had before P1 put fronts
 * under fronts/), and after; review-triage.md, no Doc at the root, read at its old path both times. */
function docPairs(plan: Plan): { before: Map<string, Doc>; after: Map<string, Doc> } {
  const { before, p1 } = plan;
  const at = (p: string) => (p === REVIEW_TRIAGE ? p : phase1Path(p, p1.dirs));
  const b = docsOf(before.specs, at);
  const afterSpecs = new Map(p1.specs);
  const triage = phase1Path(REVIEW_TRIAGE, p1.dirs);
  if (afterSpecs.has(triage)) {
    afterSpecs.set(REVIEW_TRIAGE, afterSpecs.get(triage)!);
    afterSpecs.delete(triage);
  }
  const a = docsOf(afterSpecs);
  return { before: new Map(b.map((d) => [d.ref, d])), after: new Map(a.map((d) => [d.ref, d])) };
}

/**
 * O2: every document's place and parse are the same; only its ref gained the prefix. A metadata value may hold a
 * markdown link (`reference: "… [decision 116](../../decisions-taken-steps.md) …"`), which phase 1 rebases like
 * any link of the body: each value is compared with its links replaced by the final file they name (from the
 * document's old path before, its new path after), so a rebased link is no difference and any other change is.
 */
export function oracleDocsSame(plan: Plan): OracleResult {
  const { before, after } = docPairs(plan);
  const { p1 } = plan;
  const oldPath = new Map([...p1.moves].map(([o, n]) => [n, o]));
  const map: TargetMap = (t) => phase1Path(t, p1.dirs);
  const metaOf = (d: Doc, file: string, m: TargetMap) =>
    Object.fromEntries(Object.entries(d.meta).map(([k, v]) => [k, normalizeLinks(v.split("\n"), file, m).join("\n")]));
  const pick = (d: Doc, meta: Record<string, string>) => ({
    version: d.version,
    owner: d.owner,
    front: d.front,
    group: d.group,
    name: d.name,
    title: d.title,
    meta,
    anchors: d.sections.map((s) => s.anchor),
  });
  const problems: string[] = [];
  for (const [ref, d] of before) {
    const a = after.get(ref);
    if (!a) {
      problems.push(`${ref}: no document after`);
      continue;
    }
    // review-triage.md is read at its old path both times (docPairs); its file now sits at the root.
    const newFile = ref === refOf(REVIEW_TRIAGE) ? phase1Path(REVIEW_TRIAGE, p1.dirs) : `${ref}.md`;
    const oldFile = oldPath.get(newFile) ?? newFile;
    const x = pick(d, metaOf(d, oldFile, map));
    const y = pick(a, metaOf(a, newFile, (t) => t));
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      const keys = Object.keys({ ...x.meta, ...y.meta }).filter((k) => x.meta[k] !== y.meta[k]);
      problems.push(`${ref}: differs${keys.length ? ` (meta ${keys.join(", ")})` : ""}`);
    }
  }
  return problems.length ? fail(few(problems)) : pass(`${before.size} document(s): same version, owner, front, group, name, title, meta and anchors`);
}

/** O3: the fronts before and after agree; each current front gains one document per companion. */
export function oracleFronts(plan: Plan): OracleResult {
  const { before, after } = docPairs(plan);
  const b = frontsOf([...before.values()]);
  const a = frontsOf([...after.values()]);
  const own = (f: Front) => f.docs.filter((d) => !d.endsWith(COMPANION));
  const problems: string[] = [];
  if (a.length !== b.length) problems.push(`${b.length} front(s) before, ${a.length} after`);
  for (const f of b) {
    const g = a.find((x) => x.ref === f.ref);
    if (!g) {
      problems.push(`${f.ref}: gone`);
      continue;
    }
    const k = (x: Front) => JSON.stringify([x.version, x.num, x.slug, x.ref, x.owner, x.title, own(x).length]);
    if (k(f) !== k(g)) problems.push(`${f.ref}: differs`);
    const added = plan.p1.companions.filter((c) => c.startsWith(`${f.ref}/`)).length;
    if (g.docs.length - f.docs.length !== added) problems.push(`${f.ref}: ${g.docs.length - f.docs.length} doc(s) gained, ${added} companion(s)`);
  }
  return problems.length ? fail(few(problems)) : pass(`${b.length} front(s) identical; ${plan.p1.companions.length} companion(s) counted`);
}

/** Writes a data set into a throwaway checkout (decisions files included) for loadStore/check. */
function materialize(data: DataSet): string {
  const dir = mkdtempSync(join(tmpdir(), "fronts-move-"));
  for (const [p, b] of data.specs) {
    mkdirSync(dirname(join(dir, "specs", p)), { recursive: true });
    writeFileSync(join(dir, "specs", p), b);
  }
  if (data.moved) writeFileSync(join(dir, "moved.json"), `${JSON.stringify(Object.fromEntries(data.moved), null, 2)}\n`);
  return dir;
}

function checkOf(data: DataSet): Finding[] {
  const dir = materialize(data);
  try {
    return check(loadStore(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * check() over `before` and `after`, each finding normalized (its doc ref and its paths mapped to the result's,
 * a broken link to the final file it names): no finding is new. A finding that is gone is listed: the
 * doc-owner-outside-front each front README raises before (P1's docMeta reads no front outside fronts/), and
 * whatever was about a file that is no document after (review-triage.md, status.md, fronts.md).
 */
export function checkParity(plan: Plan, after: DataSet, map: TargetMap, refMap: (ref: string) => string): OracleResult {
  const text = textRewriter(plan.p1.dirs);
  const norm = (f: Finding, ref: (r: string) => string, docPath: (r: string) => string) => {
    let message = f.message;
    const link = f.code === "doc-link-broken" && message.match(/^links to (.+), which does not exist$/);
    if (link) message = `→ ${finalTarget(docPath(f.about), link[1]!, map)}`;
    else message = text(message);
    return JSON.stringify({ code: f.code, severity: f.severity, about: ref(f.about), message });
  };
  const b = checkOf(plan.before).map((f) => norm(f, refMap, (r) => `${r}.md`));
  const a = checkOf(after).map((f) => norm(f, (r) => r, (r) => `${r}.md`));
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const cb = count(b);
  const ca = count(a);
  const added = [...ca].filter(([k, n]) => n > (cb.get(k) ?? 0)).map(([k]) => k);
  const gone = [...cb].filter(([k, n]) => n > (ca.get(k) ?? 0)).map(([k]) => k);
  if (added.length) return fail(`new finding(s): ${few(added, 5)}`);
  const goneBy = new Map<string, number>();
  for (const g of gone) {
    const code = (JSON.parse(g) as { code: string }).code;
    goneBy.set(code, (goneBy.get(code) ?? 0) + 1);
  }
  const goneText = [...goneBy].map(([c, n]) => `${n} ${c}`).join(", ") || "none";
  return pass(`${a.length} finding(s) after, none new; gone: ${goneText}`);
}

/** O4: check() over phase 1's result finds nothing new. */
export function oracleCheck(plan: Plan): OracleResult {
  return checkParity(plan, { specs: plan.p1.specs, moved: plan.p1.moved }, (t) => phase1Path(t, plan.p1.dirs), (r) => phase1Path(r, plan.p1.dirs));
}

/** O5: every relative link names, after phase 1, the file it named before. */
export function oracleLinks(plan: Plan): OracleResult {
  const { before, p1 } = plan;
  const map: TargetMap = (t) => phase1Path(t, p1.dirs);
  let n = 0;
  const problems: string[] = [];
  for (const [p, b] of before.specs) {
    if (!isMd(p)) continue;
    const np = phase1Path(p, p1.dirs);
    const xs = linkTargets(txt(b).split("\n"));
    const ys = linkTargets(txt(p1.specs.get(np)).split("\n"));
    if (xs.length !== ys.length) {
      problems.push(`${np}: ${xs.length} link(s) before, ${ys.length} after`);
      continue;
    }
    xs.forEach((x, i) => {
      if (EXTERNAL.test(x)) return;
      n++;
      const want = finalTarget(p, x, map);
      const got = finalTarget(np, ys[i]!, (t) => t);
      if (want !== got) problems.push(`${np}: ${x} → ${ys[i]} names ${got}, not ${want}`);
    });
  }
  return problems.length ? fail(few(problems)) : pass(`${n} relative link(s) name the same file; ${p1.links.total} rewritten, ${p1.links.frontMilestone} of them between a front and milestone/`);
}

function refExists(specs: Map<string, Buffer>, ref: string): boolean {
  return specs.has(`${ref}.md`) || specs.has(`${ref}/README.md`);
}

/** moved.json's every old key still answers in one step, and every value it gained names a file. */
export function movedParity(
  before: Map<string, string> | undefined,
  after: Map<string, string>,
  specs: Map<string, Buffer>,
  beforeSpecs: Map<string, Buffer>,
): OracleResult {
  const problems: string[] = [];
  for (const k of before?.keys() ?? []) if (!after.has(k)) problems.push(`${k}: key lost`);
  for (const [k, v] of after) {
    if (isPermalink(v)) continue;
    if (after.has(v) && after.get(v) !== v) problems.push(`${k} → ${v}: a chain`);
    const old = before?.get(k);
    // A value that already named nothing (a stale entry) is re-pointed, not made to exist.
    const stale = old !== undefined && !isPermalink(old) && !refExists(beforeSpecs, old) && !before?.has(old);
    if (old !== v && !stale && !refExists(specs, v)) problems.push(`${k} → ${v}: no such document`);
  }
  return problems.length ? fail(few(problems)) : pass(`${after.size} entr(ies), no chain; every new value exists`);
}

/** O6 */
export function oracleMoved(plan: Plan): OracleResult {
  return movedParity(plan.before.moved, plan.p1.moved, plan.p1.specs, plan.before.specs);
}

/** O7 / S7: a second dry-run over the result has nothing to do. */
export function oracleIdempotent(plan: Plan): OracleResult {
  const again = planMove(plan.after, new Map(), plan.allMilestones);
  if (nothingToDo(again)) return pass("a second run has nothing to do");
  return fail(
    `a second run would move ${again.p1.moves.size} file(s), rewrite ${again.p1.rewritten.size}, add ${again.p1.companions.length} companion(s)${again.p2.ran ? ", relocate status/fronts again" : ""}`,
  );
}

// The relocated text, for S1–S3: [file, its relocated lines (with the line's own path for link resolution)].
interface Relocated {
  file: string;
  lines: string[];
}

function relocatedOf(plan: Plan): Relocated[] {
  const out: Relocated[] = [];
  for (const path of plan.p2.touched) {
    const now = txt(plan.after.specs.get(path)).split("\n");
    const was = plan.p1.specs.has(path) ? txt(plan.p1.specs.get(path)).replace(/\n+$/, "").split("\n") : [];
    // A companion phase 1 wrote keeps its template on top; phase 2 only appended after it.
    const skip = was.length ? was.length : (splitMeta(now).end + 1);
    out.push({ file: path, lines: now.slice(skip) });
  }
  for (const path of [ORDER, RULES]) {
    if (!plan.after.specs.has(path)) continue;
    const now = txt(plan.after.specs.get(path)).split("\n");
    out.push({ file: path, lines: now.slice(splitMeta(now).end) });
  }
  return out;
}

/** The lines S1/S2 compare: non-blank, no heading, no metadata, no Execution-order table header; links resolved. */
function contentLines(lines: string[], file: string, map: TargetMap, skipMeta: boolean): { line: string; section: number }[] {
  const start = skipMeta ? splitMeta(lines).end : 0;
  const doc = parseDoc(file.includes("/") ? file : `x/${file}`, lines.join("\n"));
  const headAt = new Set(doc.sections.map((s) => s.start));
  const norm = normalizeLinks(lines, file, map);
  const out: { line: string; section: number }[] = [];
  let section = 0;
  let head = false;
  norm.forEach((l, i) => {
    if (i < start) return;
    if (headAt.has(i)) {
      section++;
      return;
    }
    if (l.trim() === "") return;
    if (TABLE_HEAD.test(l)) {
      head = true;
      return;
    }
    if (head && TABLE_DELIM.test(l)) {
      head = false;
      return;
    }
    head = false;
    out.push({ line: l, section });
  });
  return out;
}

function sourcesOf(plan: Plan): { status: string[]; fronts: string[]; map: TargetMap } {
  const frontsText = plan.p1.specs.has(FRONTS_MD) ? txt(plan.p1.specs.get(FRONTS_MD)) : undefined;
  const fd = frontsText !== undefined ? parseDoc(FRONTS_MD, frontsText) : undefined;
  const exec = fd?.sections.find((s) => s.level === 2 && s.heading === "Execution order");
  const anchors = new Set(fd && exec ? fd.sections.filter((s) => s.start >= exec.start && s.start < exec.end).map((s) => s.anchor) : []);
  const map = phase2Map(anchors);
  const src = (p: string) => (plan.p1.specs.has(p) ? contentLines(txt(plan.p1.specs.get(p)).split("\n"), p, map, true).map((x) => x.line) : []);
  return { status: src(STATUS), fronts: src(FRONTS_MD), map };
}

/** S1: the relocated lines are exactly status.md's and fronts.md's, each in one place, none invented. */
export function oracleLinesKept(plan: Plan): OracleResult {
  if (!plan.p2.ran) return pass("nothing relocated");
  const { status, fronts } = sourcesOf(plan);
  const want = [...status, ...fronts];
  const got = relocatedOf(plan).flatMap((r) => contentLines(r.lines, r.file, (t) => t, false).map((x) => x.line));
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const cw = count(want);
  const cg = count(got);
  const missing = [...cw].filter(([k, n]) => (cg.get(k) ?? 0) < n).map(([k, n]) => `${k.slice(0, 80)} (${n} → ${cg.get(k) ?? 0})`);
  const extra = [...cg].filter(([k, n]) => (cw.get(k) ?? 0) < n).map(([k, n]) => `${k.slice(0, 80)} (${cw.get(k) ?? 0} → ${n})`);
  if (missing.length || extra.length) return fail(`missing: ${few(missing, 4) || "none"}; extra: ${few(extra, 4) || "none"}`);
  return pass(`${want.length} line(s) (status.md ${status.length}, fronts.md ${fronts.length}) each in exactly one destination`);
}

function isSubsequence(xs: string[], of: string[]): boolean {
  let j = 0;
  for (const x of xs) {
    while (j < of.length && of[j] !== x) j++;
    if (j === of.length) return false;
    j++;
  }
  return true;
}

/** S2: inside each destination section, the lines keep their source order. */
export function oracleOrder(plan: Plan): OracleResult {
  if (!plan.p2.ran) return pass("nothing relocated");
  const { status, fronts } = sourcesOf(plan);
  const problems: string[] = [];
  let sections = 0;
  for (const r of relocatedOf(plan)) {
    const lines = contentLines(r.lines, r.file, (t) => t, false);
    const bySection = new Map<number, string[]>();
    for (const l of lines) (bySection.get(l.section) ?? bySection.set(l.section, []).get(l.section)!).push(l.line);
    for (const [s, ls] of bySection) {
      sections++;
      if (!isSubsequence(ls, status) && !isSubsequence(ls, fronts)) problems.push(`${r.file} section ${s}: out of the source's order`);
    }
  }
  return problems.length ? fail(few(problems)) : pass(`${sections} destination section(s) in source order`);
}

/** S3: the site's statusItems() reads the same items per front from status.md and from where they went. */
export function oracleProgress(plan: Plan): OracleResult {
  if (!plan.p2.ran || !plan.p1.specs.has(STATUS)) return pass("no status.md");
  const { map } = sourcesOf(plan);
  const nums = new Set(frontsOf(docsOf(plan.after.specs)).map((f) => f.num));
  const items = (file: string, lines: string[], m: TargetMap) => {
    const doc = parseDoc(file, normalizeLinks(lines, file, m).join("\n"));
    return statusItems(doc, nums).map((x) => JSON.stringify([x.front, x.item.state, x.item.lane, x.item.label, x.item.text]));
  };
  const before = items(STATUS, txt(plan.p1.specs.get(STATUS)).split("\n"), map).sort();
  const after = [...plan.p2.touched, ORDER, RULES]
    .filter((p) => plan.after.specs.has(p))
    .flatMap((p) => items(p, txt(plan.after.specs.get(p)).split("\n"), (t) => t))
    .sort();
  if (JSON.stringify(before) === JSON.stringify(after)) return pass(`${before.length} status item(s), the same per front, label, state and lane`);
  const onlyB = before.filter((x) => !after.includes(x));
  const onlyA = after.filter((x) => !before.includes(x));
  return fail(`only before: ${few(onlyB, 4) || "none"}; only after: ${few(onlyA, 4) || "none"}`);
}

/** S4: the companions are exactly the eligible documents', one each. */
export function oracleCompanions(plan: Plan): OracleResult {
  const docs = docsOf(plan.p1.specs).filter((d) => !plan.p1.companions.includes(`${d.ref}.md`));
  const current = currentOf(docsOf(plan.p1.specs));
  const want = docs
    .filter((d) => eligible(d, plan.p1.dirs, current, plan.allMilestones) && plan.p1.moves.size > 0)
    .map((d) => `${d.ref}${COMPANION}.md`)
    .filter((c) => !plan.p1.collisions.includes(c))
    .sort();
  const got = [...plan.after.specs.keys()].filter((p) => p.endsWith(`${COMPANION}.md`) && !plan.before.specs.has(p)).sort();
  if (plan.p1.collisions.length) return fail(`would overwrite: ${few(plan.p1.collisions)}`);
  if (JSON.stringify(want) === JSON.stringify(got)) return pass(`${got.length} companion(s), one per eligible document`);
  return fail(`eligible without one: ${few(want.filter((w) => !got.includes(w))) || "none"}; extra: ${few(got.filter((g) => !want.includes(g))) || "none"}`);
}

/** S5: check() over the result finds nothing new. */
export function oracleCheckFinal(plan: Plan): OracleResult {
  const map1: TargetMap = (t) => phase1Path(t, plan.p1.dirs);
  const anchors = (() => {
    const t = plan.p1.specs.has(FRONTS_MD) ? txt(plan.p1.specs.get(FRONTS_MD)) : undefined;
    if (t === undefined) return new Set<string>();
    const d = parseDoc(FRONTS_MD, t);
    const e = d.sections.find((s) => s.level === 2 && s.heading === "Execution order");
    return new Set(e ? d.sections.filter((s) => s.start >= e.start && s.start < e.end).map((s) => s.anchor) : []);
  })();
  const map2 = phase2Map(anchors);
  const map: TargetMap = (t, a, after) => map2(map1(t, a), a, after);
  const refMap = (r: string) => {
    const p = phase1Path(r, plan.p1.dirs);
    return p === refOf(STATUS) ? refOf(ORDER) : p === refOf(FRONTS_MD) ? refOf(RULES) : p;
  };
  return checkParity(plan, plan.after, map, refMap);
}

/** S6: milestone/status and milestone/fronts answer, through moved.json, with order and rules. */
export function oracleRedirects(plan: Plan): OracleResult {
  const m = movedParity(plan.before.moved, plan.after.moved ?? new Map(), plan.after.specs, plan.before.specs);
  if (!m.ok) return m;
  if (!plan.p2.ran) return pass(`no status/fronts to redirect; ${m.detail}`);
  const problems: string[] = [];
  for (const [from, to] of [
    [STATUS, ORDER],
    [FRONTS_MD, RULES],
  ] as const) {
    if (!plan.p1.specs.has(from)) continue;
    const got = plan.after.moved?.get(refOf(from));
    if (got !== refOf(to)) problems.push(`${refOf(from)} → ${got ?? "nothing"}, not ${refOf(to)}`);
    if (!plan.after.specs.has(to)) problems.push(`${to} does not exist`);
  }
  if (plan.before.specs.has(REVIEW_TRIAGE) && plan.after.moved?.get(refOf(REVIEW_TRIAGE)) !== "review-triage") problems.push("milestone/review-triage does not answer review-triage");
  return problems.length ? fail(problems.join("; ")) : pass(`milestone/status → milestone/order, milestone/fronts → milestone/rules; ${m.detail}`);
}

export interface NamedOracle {
  name: string;
  run: (plan: Plan) => OracleResult;
}

export const ORACLES: NamedOracle[] = [
  { name: "O1 files at their place", run: oracleFilesMoved },
  { name: "O2 documents read the same", run: oracleDocsSame },
  { name: "O3 fronts the same", run: oracleFronts },
  { name: "O4 check() nothing new (phase 1)", run: oracleCheck },
  { name: "O5 links name the same file", run: oracleLinks },
  { name: "O6 moved.json answers", run: oracleMoved },
  { name: "O7 a second run has nothing to do", run: oracleIdempotent },
  { name: "S1 every line in one place", run: oracleLinesKept },
  { name: "S2 source order kept", run: oracleOrder },
  { name: "S3 the site's status items the same", run: oracleProgress },
  { name: "S4 one companion per eligible document", run: oracleCompanions },
  { name: "S5 check() nothing new (result)", run: oracleCheckFinal },
  { name: "S6 status/fronts redirect", run: oracleRedirects },
  { name: "S7 a second run has nothing to do", run: oracleIdempotent },
];

export function runOracles(plan: Plan): { name: string; result: OracleResult }[] {
  return ORACLES.map(({ name, run }) => {
    try {
      return { name, result: run(plan) };
    } catch (e) {
      return { name, result: fail(`threw: ${(e as Error).message}`) };
    }
  });
}

// ── the CLI ──

export function loadOverride(arg?: string): Map<string, string> {
  if (!arg) return new Map();
  const raw = arg.trim().startsWith("{") ? arg : readFileSync(arg, "utf8");
  const obj = JSON.parse(raw) as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") throw new Error(`--override: ${k} must map to a string`);
    out.set(k, v);
  }
  return out;
}

export function summary(plan: Plan): string[] {
  const { p1, p2 } = plan;
  const docs = [...p1.moves.keys()].filter(isMd).length;
  const c = p2.counts;
  const out = [
    `phase 1: ${p1.moves.size} file(s) moved (${docs} document(s)) from ${p1.dirs.size} front folder(s)${plan.before.specs.has(REVIEW_TRIAGE) ? ", milestone/review-triage.md to the root" : ""}`,
    `phase 1: ${p1.links.total} link(s) rewritten in ${p1.rewritten.size} file(s), ${p1.links.frontMilestone} between a front and milestone/; ${p1.companions.length} companion(s)`,
  ];
  if (p2.ran) {
    out.push(
      `phase 2: status.md items — rule 1 (front heading) ${c.items.front}, rule 2 (multi-front, by item) ${c.items.multi}, rule 2 left global ${c.items.multiGlobal}, rule 3 by override ${c.items.override}, rule 3 ambiguous (global) ${c.items.ambiguous}, rule 4 global ${c.items.global}`,
      `phase 2: fronts.md old ids — resolved ${c.ids.resolved}, by override ${c.ids.override}, ambiguous ${c.ids.ambiguous}, unknown ${c.ids.unknown}; ${p2.touched.length} companion(s) filled; ${p2.relinked} line(s) relinked`,
    );
  }
  return out;
}

function printReport(plan: Plan, outcomes: { name: string; result: OracleResult }[]): boolean {
  if (nothingToDo(plan)) console.log("nothing to do");
  for (const l of summary(plan)) console.log(l);
  for (const h of plan.p2.headings.filter((x) => x.rule === "ambiguous" || x.rule === "override" || x.rule === "multi")) {
    console.log(`  heading [${h.rule}] "${h.heading}" (${h.lane})${h.dirs.length ? ` → ${h.dirs.join(", ")}` : ""}${h.why ? ` — ${h.why}` : ""}`);
  }
  for (const r of plan.p2.ids.filter((x) => x.kind !== "resolved")) {
    console.log(`  old id [${r.kind}] ${r.id}${r.dir ? ` → ${r.dir}` : ""}${r.holders.length ? ` (alias tables: ${r.holders.join(", ")})` : ""}`);
  }
  let ok = true;
  for (const { name, result } of outcomes) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${name} — ${result.detail}`);
    if (!result.ok) ok = false;
  }
  return ok;
}

export function refusal(plan: Plan, outcomes: { name: string; result: OracleResult }[]): string | undefined {
  const failed = outcomes.filter((o) => !o.result.ok).map((o) => o.name);
  if (failed.length) return `an oracle failed (${failed.join(", ")}); nothing written`;
  if (plan.p2.ambiguous.length) {
    return `ambiguous status.md heading(s), name each in --override (a front folder or "global"); nothing written:\n${plan.p2.ambiguous
      .map((h) => `  "${h.heading}" (${h.lane}) — ${h.why}`)
      .join("\n")}`;
  }
  return undefined;
}

export function commitMessage(plan: Plan): { subject: string; body: string } {
  return { subject: "fronts-move: every front under specs/fronts/, status.md and fronts.md relocated", body: summary(plan).join("\n") };
}

/** Writes the plan's result over the checkout: one commit with `.git`, a plain rename without. */
export async function apply(specsData: string, plan: Plan): Promise<void> {
  const specsDir = join(specsData, "specs");
  const removed = [...plan.before.specs.keys()].filter((p) => !plan.after.specs.has(p));
  const written = [...plan.after.specs].filter(([p, b]) => !plan.before.specs.get(p)?.equals(b)).map(([p]) => p);
  const repo = existsSync(join(specsData, ".git"));
  const batches = <T>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  if (repo) for (const b of batches(removed)) await git(specsData, ["rm", "-q", "--", ...b.map((p) => `specs/${p}`)]);
  else for (const p of removed) unlinkSync(join(specsDir, p));
  for (const p of written) {
    mkdirSync(dirname(join(specsDir, p)), { recursive: true });
    writeFileSync(join(specsDir, p), plan.after.specs.get(p)!);
  }
  const movedChanged = !sameMap(plan.before.moved ?? new Map(), plan.after.moved ?? new Map());
  if (movedChanged) writeFileSync(join(specsData, "moved.json"), `${JSON.stringify(Object.fromEntries(plan.after.moved!), null, 2)}\n`);
  pruneEmpty(specsDir);
  if (repo) {
    const paths = [...written.map((p) => `specs/${p}`), ...(movedChanged ? ["moved.json"] : [])];
    for (const b of batches(paths)) await git(specsData, ["add", "--", ...b]);
    const { subject, body } = commitMessage(plan);
    await git(specsData, ["commit", "-q", "-m", subject, "-m", body]);
  }
}

function pruneEmpty(dir: string): boolean {
  let empty = true;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && pruneEmpty(join(dir, e.name))) rmdirSync(join(dir, e.name));
    else empty = false;
  }
  return empty;
}

function usage(): never {
  console.error("usage: fronts-move.ts dry-run|migrate --specs-data <specs-data checkout> [--override <file.json | json>] [--all-milestones]");
  process.exit(2);
}

function parseArgs(argv: string[]): { specsData: string; override?: string; all: boolean } {
  let specsData: string | undefined;
  let override: string | undefined;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--specs-data") specsData = argv[++i];
    else if (argv[i] === "--override") override = argv[++i];
    else if (argv[i] === "--all-milestones") all = true;
    else usage();
  }
  if (!specsData) usage();
  return { specsData, all, ...(override !== undefined ? { override } : {}) };
}

/** dry-run and migrate's shared computation; returns the exit code. */
export async function run(cmd: "dry-run" | "migrate", specsData: string, overrideArg?: string, all = false): Promise<number> {
  const plan = planMove(readDataSet(specsData), loadOverride(overrideArg), all);
  const outcomes = runOracles(plan);
  const ok = printReport(plan, outcomes);
  if (cmd === "dry-run") return ok ? 0 : 1;
  const why = refusal(plan, outcomes);
  if (why) {
    console.error(`migrate: ${why}`);
    return 1;
  }
  if (nothingToDo(plan)) return 0;
  await apply(specsData, plan);
  console.log(`migrate: written${existsSync(join(specsData, ".git")) ? " and committed" : ""}`);
  return 0;
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "dry-run" && cmd !== "migrate") usage();
  const { specsData, override, all } = parseArgs(rest);
  process.exit(await run(cmd, specsData, override, all));
}
