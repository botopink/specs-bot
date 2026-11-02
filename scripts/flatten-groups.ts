#!/usr/bin/env bun
// Promotes every `group` (doc.ts's second numbered folder nested inside a front) to a front of its own,
// directly under fronts/, at the same level as every other front (the maintainer: a group is never nested
// again). The front that held it keeps existing, with whatever still sits directly in it.
//
//   bun scripts/flatten-groups.ts dry-run --specs-data <specs-data checkout> [--override <file.json | json>]
//   bun scripts/flatten-groups.ts migrate --specs-data <specs-data checkout> [--override <file.json | json>]
//
// 1. every document whose `group` is set (doc.ts's docMeta) is grouped by (front.dir, group.dir) — one
//    promotion per pair.
// 2. a group named exactly like the front it sits in (a leftover of the pre-flatten nesting, e.g.
//    fronts/105-i18n/105-i18n/) merges straight into that front — no new front, no number spent; the
//    maintainer: a group is never its own front's twin. Every other group keeps its own number unless
//    it is already another front's or an earlier group's — walked in stable key order, so a real tree's
//    many collisions (one leading number reused by several unrelated fronts and groups alike) resolve on
//    their own instead of asking for an --override per pair: a colliding group gets the next number above
//    every one a front holds today, never a lower gap a retired front's number might still carry meaning
//    at. An --override entry (keyed `<front-dir>/<group-dir>`, e.g. "08-misc/70-misc-extra",
//    valued the "NNN-slug" to force) still takes precedence over both rules, when the maintainer wants a
//    particular number instead of the one auto-assigned.
// 3. fronts/<front>/<group>/… → fronts/<its-slot>/…; the front directory keeps whatever sat directly in it
//    (its own README.md and the files that were in no group) — gone entirely when nothing did.
// 4. every relative link and every bare `specs/fronts/<front>/<group>/` mention is rewritten: fronts-move.ts's
//    rewriteLines/rebaseLink/finalTarget, reused here, never reimplemented.
// 5. moved.json gains `<old ref> → <new ref>` per promoted document, chains collapsed (fronts-move.ts's
//    collapse, reused).
// 6. a promoted group's own README, when it had none of its own and inherited milestone/owner from its front's
//    README (load.ts's placeOf), gets them written explicitly — merged into what it already has (never
//    overwritten), a minimal README created when the group had none; a self-merging group creates or amends
//    nothing (it has no front of its own — the one it merged into keeps its own README as is).
//
// A group nested two levels deep (a group inside a group a pass just promoted) needs more than one pass:
// the CLI loops dry-run or migrate until a pass finds nothing left, migrate committing each pass on its own.
// Five oracles gate every pass: O1 nothing lost, O2 metadata preserved, O3 no new collision, O5 links still
// resolve, O6 moved.json answers. Two more are checked only once a pass's own lookahead shows nothing is
// left to promote after it — a group this very pass promoted still reads as "outside its front" to check()
// and still has more to flatten to a further dry-run, both real but only because a later pass resolves
// them: O4 check() no worse, and O7 idempotent, which a mid-loop pass never even reaches (its own loop
// condition is exactly O7's definition). migrate writes a pass only when every oracle due at that pass
// passes; runOracles runs all seven unconditionally, for a single planFlatten call outside the CLI's loop.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { check, type Finding } from "../packages/core/src/check.ts";
import { type Doc, FRONTS_DIR, parseDoc } from "../packages/core/src/docs/doc.ts";
import { placeDocs } from "../packages/core/src/docs/load.ts";
import { metaLines, type Meta, splitMeta, withMeta } from "../packages/core/src/docs/meta.ts";
import { loadStore } from "../packages/core/src/store.ts";
import { git } from "../packages/core/src/write/git.ts";
import {
  collapse,
  type DataSet,
  finalTarget,
  linkTargets,
  loadOverride,
  movedParity,
  type OracleResult,
  readDataSet,
  rebaseLink,
  rewriteLines,
  type TargetMap,
} from "./fronts-move.ts";

const NUMBERED = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;
const EXTERNAL = /^(https?:|mailto:|#|\/)/;

const isMd = (p: string) => p.endsWith(".md");
const txt = (b: Buffer | undefined) => (b ? b.toString("utf8") : "");
const buf = (s: string) => Buffer.from(s, "utf8");
const refOf = (p: string) => p.replace(/\.md$/, "");
const isPermalink = (v: string) => /^https?:/.test(v);

// ── grouping ──

export interface GroupInfo {
  /** `<front.dir>/<group.dir>`, e.g. "08-misc/70-misc-extra" — what --override keys on. */
  key: string;
  frontDir: string;
  groupDir: string;
  groupNum: number;
  groupSlug: string;
  /** Every document under this group, before. */
  docs: Doc[];
}

/** Docs of a file set, placed (version, owner) the way load.ts places them. */
function docsOf(specs: Map<string, Buffer>): Doc[] {
  const docs: Doc[] = [];
  for (const [p, b] of specs) if (isMd(p) && p.includes("/") && !p.startsWith("decisions-taken/")) docs.push(parseDoc(p, txt(b)));
  placeDocs(docs);
  return docs;
}

function groupsOf(docs: Doc[]): GroupInfo[] {
  const byKey = new Map<string, GroupInfo>();
  for (const d of docs) {
    if (!d.front || !d.group) continue;
    const key = `${d.front.dir}/${d.group.dir}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, frontDir: d.front.dir, groupDir: d.group.dir, groupNum: d.group.num, groupSlug: d.group.slug, docs: [] };
      byKey.set(key, g);
    }
    g.docs.push(d);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Every top-level front directory of the tree (a group's own parent included; it keeps existing). */
function frontDirsOf(docs: Doc[]): Set<string> {
  return new Set(docs.filter((d) => d.front).map((d) => d.front!.dir));
}

export interface Renumbering {
  key: string;
  from: string;
  to: string;
}

export interface DestResult {
  dest: Map<string, string>;
  /** Every group an explicit --override named (its own number otherwise colliding or not). */
  overridden: Set<string>;
  /** A group promoted straight into the front that already holds its exact name — no new front. */
  selfMerge: Set<string>;
  /** A colliding group given a fresh number, in key order — the number it would have kept is `from`. */
  renumbered: Renumbering[];
}

/**
 * One front slot per group, `override` honoured first. A group whose own dir names the front it
 * already lives in (the maintainer: a leftover of the pre-flatten nesting, never a real promotion)
 * merges straight into that front — no new front, no number spent. Every other group keeps its own
 * number when free; a colliding one gets the lowest free number above every number already in use,
 * groups walked in their stable key order so two runs over the same tree always agree.
 */
function destOf(groups: GroupInfo[], frontDirs: Set<string>, override: Map<string, string>): DestResult {
  const dest = new Map<string, string>();
  const overridden = new Set<string>();
  const selfMerge = new Set<string>();
  const renumbered: Renumbering[] = [];
  const used = new Set<number>();
  for (const d of frontDirs) {
    const m = d.match(NUMBERED);
    if (m) used.add(Number(m[1]));
  }
  // Climbs from above every number a front holds today, never a low gap: a retired front's old number
  // is free here too but may still carry meaning in a decision or a chat line from before it retired.
  let nextFree = Math.max(0, ...used) + 1;
  for (const g of groups) {
    const forced = override.get(g.key);
    if (forced !== undefined) {
      dest.set(g.key, forced);
      overridden.add(g.key);
      const m = forced.match(NUMBERED);
      if (m) used.add(Number(m[1]));
      continue;
    }
    if (g.groupDir === g.frontDir) {
      dest.set(g.key, g.frontDir);
      selfMerge.add(g.key);
      continue;
    }
    if (!used.has(g.groupNum)) {
      dest.set(g.key, g.groupDir);
      used.add(g.groupNum);
      continue;
    }
    while (used.has(nextFree)) nextFree++;
    const to = `${nextFree}-${g.groupSlug}`;
    dest.set(g.key, to);
    used.add(nextFree);
    renumbered.push({ key: g.key, from: g.groupDir, to });
  }
  return { dest, overridden, selfMerge, renumbered };
}

function numbersOf(dirs: Iterable<string>): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const d of dirs) {
    const m = d.match(NUMBERED);
    if (!m) continue;
    const n = Number(m[1]);
    const set = out.get(n) ?? new Set<string>();
    set.add(d);
    out.set(n, set);
  }
  return out;
}

export interface Collision {
  num: number;
  dirs: string[];
}

/** A safety net over destOf's own bookkeeping: every front number a newly placed group's destination
 * (self-merge excluded — it lands on a front already there) still shares with an existing front or
 * another placed group, once `dest` is applied (destOf's auto-numbering is expected to leave this
 * empty; a non-empty result means an --override itself collided with something). A real tree's own
 * fronts routinely reuse a leading number across unrelated, already-frozen milestones — that is none
 * of this script's business and is never reported here, only a number a *placement* lands on. */
function collisionsOf(frontDirs: Set<string>, dest: DestResult): Collision[] {
  const placed = new Set([...dest.dest].filter(([k]) => !dest.selfMerge.has(k)).map(([, v]) => v));
  const byNum = numbersOf([...frontDirs, ...placed]);
  return [...byNum]
    .filter(([, ds]) => ds.size > 1 && [...ds].some((d) => placed.has(d)))
    .map(([num, ds]) => ({ num, dirs: [...ds].sort() }))
    .sort((a, b) => a.num - b.num);
}

// ── moving ──

/** Where a path under fronts/<front>/<group>/… sits after promotion; every other path is unchanged. */
function destPath(p: string, dest: Map<string, string>): string {
  const parts = p.split("/");
  if (parts[0] === FRONTS_DIR && parts[1] && parts[2]) {
    const to = dest.get(`${parts[1]}/${parts[2]}`);
    if (to) return [FRONTS_DIR, to, ...parts.slice(3)].join("/");
  }
  return p;
}

function textRewriter(dest: Map<string, string>): (s: string) => string {
  if (!dest.size) return (s) => s;
  const alts = [...dest.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\w-])specs/${FRONTS_DIR}/(${alts.join("|")})/`, "g");
  return (s) => s.replace(re, (_, key: string) => `specs/${FRONTS_DIR}/${dest.get(key)}/`);
}

// ── inherited metadata ──

export interface ReadmeFix {
  key: string;
  /** An existing README gaining a field it had been inheriting. */
  existingRef?: string;
  addedMilestone?: string;
  addedOwner?: string;
  /** No README of its own: one is created, holding exactly the fields it was inheriting. */
  createPath?: string;
  createMeta?: Meta;
  createTitle?: string;
}

function readmeFixesOf(groups: GroupInfo[], dest: Map<string, string>, selfMerge: Set<string>): Map<string, ReadmeFix> {
  const out = new Map<string, ReadmeFix>();
  for (const g of groups) {
    // Merges into the front's own existing README (selfMergeReadmeConflicts flags the one case
    // where the group also has its own, which would land on the very same path) — nothing to fix.
    if (selfMerge.has(g.key)) continue;
    // docMeta keeps only the first two numbered segments (front, group) — a doc three levels deep (a
    // group nested inside this one, still to flatten in a later pass) is named "README" too, by its own
    // bare filename alone, so a ref match (not just the name) is the only way to mean the group's own.
    const readme = g.docs.find((d) => d.ref === `${FRONTS_DIR}/${g.frontDir}/${g.groupDir}/README`);
    const rep = readme ?? [...g.docs].sort((a, b) => a.ref.localeCompare(b.ref))[0]!;
    const inheritedVersion = rep.version;
    const inheritedOwner = rep.owner;
    if (readme) {
      const own = readme.meta;
      const addedMilestone = own.milestone ? undefined : inheritedVersion;
      const addedOwner = own.owner || !inheritedOwner ? undefined : inheritedOwner;
      if (addedMilestone || addedOwner) {
        out.set(g.key, {
          key: g.key,
          existingRef: readme.ref,
          ...(addedMilestone ? { addedMilestone } : {}),
          ...(addedOwner ? { addedOwner } : {}),
        });
      }
    } else {
      const meta: Meta = { milestone: inheritedVersion, ...(inheritedOwner ? { owner: inheritedOwner } : {}) };
      out.set(g.key, {
        key: g.key,
        createPath: `${FRONTS_DIR}/${dest.get(g.key)}/README.md`,
        createMeta: meta,
        createTitle: `Front ${g.groupNum} — ${g.groupSlug}`,
      });
    }
  }
  return out;
}

// ── the plan ──

export interface Plan {
  before: DataSet;
  groups: GroupInfo[];
  dest: Map<string, string>;
  /** A group promoted straight into the front that already holds its exact name — no new front made. */
  selfMerge: Set<string>;
  /** A colliding group given a fresh number instead of its own, in key order. */
  renumbered: Renumbering[];
  /** A self-merging group that also carries its own README — it would land on the front's own; names
   * the group(s) still needing an --override. migrate refuses while any stand. */
  selfMergeConflicts: string[];
  /** Safety net only: an --override itself landed on a number already spoken for. migrate refuses while
   * any stand (destOf's own auto-numbering never leaves one). */
  collisions: Collision[];
  readmeFixes: Map<string, ReadmeFix>;
  moves: Map<string, string>;
  rewritten: Map<string, number[]>;
  /** Brand-new README paths (a group that had none of its own). */
  created: string[];
  /** The new path of a README whose metadata block gained a field — it may have grown by more than the
   * rewritten-link lines the move loop already lists, so O1 checks it through O2 (meta) instead of by line. */
  amended: Set<string>;
  after: DataSet;
}

export function planFlatten(data: DataSet, override: Map<string, string> = new Map()): Plan {
  const docs = docsOf(data.specs);
  const groups = groupsOf(docs);
  const frontDirs = frontDirsOf(docs);
  const destResult = destOf(groups, frontDirs, override);
  const { dest, selfMerge, renumbered } = destResult;
  const collisions = collisionsOf(frontDirs, destResult);
  const selfMergeConflicts = groups.filter((g) => selfMerge.has(g.key) && g.docs.some((d) => d.ref === `${FRONTS_DIR}/${g.frontDir}/${g.groupDir}/README`)).map((g) => g.key);
  const readmeFixes = readmeFixesOf(groups, dest, selfMerge);

  const map: TargetMap = (p) => destPath(p, dest);
  const text = textRewriter(dest);
  const moves = new Map<string, string>();
  for (const p of data.specs.keys()) {
    const np = destPath(p, dest);
    if (np !== p) moves.set(p, np);
  }

  const specs = new Map<string, Buffer>();
  const rewritten = new Map<string, number[]>();
  for (const [p, b] of data.specs) {
    const np = moves.get(p) ?? p;
    if (!isMd(p)) {
      specs.set(np, b);
      continue;
    }
    const r = rewriteLines(txt(b).split("\n"), (raw, after) => rebaseLink(raw, p, np, map, after), text);
    specs.set(np, buf(r.lines.join("\n")));
    if (r.changed.length) rewritten.set(np, r.changed);
  }

  const created: string[] = [];
  const amended = new Set<string>();
  for (const fix of readmeFixes.values()) {
    if (fix.existingRef) {
      const np = moves.get(`${fix.existingRef}.md`) ?? `${fix.existingRef}.md`;
      const lines = txt(specs.get(np)).split("\n");
      const { meta: own } = splitMeta(lines);
      const merged: Meta = { ...(fix.addedMilestone ? { milestone: fix.addedMilestone } : {}), ...(fix.addedOwner ? { owner: fix.addedOwner } : {}), ...own };
      specs.set(np, buf(withMeta(lines, merged).join("\n")));
      amended.add(np);
    } else if (fix.createPath && fix.createMeta) {
      specs.set(fix.createPath, buf(`${metaLines(fix.createMeta).join("\n")}\n# ${fix.createTitle}\n`));
      created.push(fix.createPath);
    }
  }

  const moved = new Map<string, string>();
  for (const [k, v] of data.moved ?? []) moved.set(k, isPermalink(v) ? v : destPath(v, dest));
  for (const [p, np] of moves) if (isMd(p)) moved.set(refOf(p), refOf(np));

  const after: DataSet = { specs, moved: collapse(moved) };
  return { before: data, groups, dest, selfMerge, renumbered, selfMergeConflicts, collisions, readmeFixes, moves, rewritten, created, amended, after };
}

/** Nothing moves, nothing is created or amended. */
export function nothingToDo(plan: Plan): boolean {
  return plan.moves.size === 0 && plan.readmeFixes.size === 0 && plan.created.length === 0;
}

// ── oracles ──

const pass = (detail: string): OracleResult => ({ ok: true, detail });
const fail = (detail: string): OracleResult => ({ ok: false, detail });
const few = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join("; ")}; … (${xs.length} in all)` : xs.join("; "));

/** O1: every file before exists after (moved or not), nothing left inside a promoted group's old place, bytes
 * equal but the listed rewritten lines, no file after but a move or a creation accounts for it. */
export function oracleNothingLost(plan: Plan): OracleResult {
  const problems: string[] = [];
  for (const [p, b] of plan.before.specs) {
    const np = plan.moves.get(p) ?? p;
    const a = plan.after.specs.get(np);
    if (!a) {
      problems.push(`${p}: missing at ${np}`);
      continue;
    }
    if (plan.amended.has(np)) continue; // its metadata block changed shape; O2 checks it field by field.
    const lines = plan.rewritten.get(np);
    if (!lines) {
      if (!a.equals(b)) problems.push(`${np}: bytes differ but it is not a rewritten file`);
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
  for (const p of plan.after.specs.keys()) {
    const parts = p.split("/");
    if (parts[0] === FRONTS_DIR && parts[1] && parts[2] && plan.dest.has(`${parts[1]}/${parts[2]}`)) problems.push(`${p}: left inside a promoted group's old place`);
  }
  const expected = new Set([...plan.before.specs.keys()].map((p) => plan.moves.get(p) ?? p));
  const extra = [...plan.after.specs.keys()].filter((p) => !expected.has(p) && !plan.created.includes(p));
  if (extra.length) problems.push(`unexpected file(s): ${few(extra)}`);
  if (problems.length) return fail(few(problems));
  return pass(`${plan.before.specs.size} file(s) accounted for (${plan.moves.size} moved, ${plan.created.length} created), rewritten line(s) only where listed`);
}

function normalizeLinks(lines: string[], fromFile: string, map: TargetMap): string[] {
  return rewriteLines(lines, (raw, after) => (EXTERNAL.test(raw) ? raw : `<${finalTarget(fromFile, raw, map, after)}>`)).lines;
}

/** O2: every document's version, owner, name, title, meta and section anchors are the same, before and after —
 * a metadata value's link rebased or bare mention prefixed is not a difference, and neither is the field a
 * README gained explicitly (readmeFixes) when it was inheriting the very same value before. */
export function oracleMetaPreserved(plan: Plan): OracleResult {
  const beforeDocs = new Map(docsOf(plan.before.specs).map((d) => [d.ref, d]));
  const afterDocs = new Map(docsOf(plan.after.specs).map((d) => [d.ref, d]));
  const map: TargetMap = (p) => destPath(p, plan.dest);
  const text = textRewriter(plan.dest);
  const fixByRef = new Map([...plan.readmeFixes.values()].filter((f) => f.existingRef).map((f) => [f.existingRef!, f]));
  const metaOf = (d: Doc, file: string, m: TargetMap) =>
    Object.fromEntries(Object.entries(d.meta).map(([k, v]) => [k, text(normalizeLinks(v.split("\n"), file, m).join("\n"))]));
  const pick = (d: Doc, meta: Record<string, string>) => ({ version: d.version, owner: d.owner, name: d.name, title: d.title, meta, anchors: d.sections.map((s) => s.anchor) });
  const problems: string[] = [];
  for (const [ref, d] of beforeDocs) {
    const oldFile = `${ref}.md`;
    const np = plan.moves.get(oldFile) ?? oldFile;
    const newRef = refOf(np);
    const a = afterDocs.get(newRef);
    if (!a) {
      problems.push(`${ref}: no document after`);
      continue;
    }
    const x = pick(d, metaOf(d, oldFile, map));
    const yMeta = metaOf(a, np, (t) => t);
    const fix = fixByRef.get(ref);
    if (fix?.addedMilestone) delete yMeta.milestone;
    if (fix?.addedOwner) delete yMeta.owner;
    const y = pick(a, yMeta);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      const keys = Object.keys({ ...x.meta, ...y.meta }).filter((k) => x.meta[k] !== y.meta[k]);
      problems.push(`${ref}: differs${keys.length ? ` (meta ${keys.join(", ")})` : ""}`);
    }
  }
  return problems.length ? fail(few(problems)) : pass(`${beforeDocs.size} document(s): same version, owner, name, title, meta and anchors`);
}

function topDirsOf(specs: DataSet["specs"]): Set<string> {
  const dirs = new Set<string>();
  for (const p of specs.keys()) {
    const parts = p.split("/");
    if (parts[0] === FRONTS_DIR && parts[1]) dirs.add(parts[1]);
  }
  return dirs;
}

/** O3: no number a directory newly placed directly under fronts/ by this pass shares with an existing
 * front or another placement. A real tree's own fronts routinely reuse a leading number across
 * unrelated, already-frozen milestones (e.g. "01-std" and "01-test-green" from different betas) — that
 * pre-existing reuse is none of this pass's doing and is left alone; only a number a placement lands
 * on is this oracle's business. */
export function oracleNoCollision(plan: Plan): OracleResult {
  const before = topDirsOf(plan.before.specs);
  const after = topDirsOf(plan.after.specs);
  const added = new Set([...after].filter((d) => !before.has(d)));
  const byNum = numbersOf(after);
  const dup = [...byNum].filter(([, s]) => s.size > 1 && [...s].some((d) => added.has(d)));
  if (dup.length) return fail(few(dup.map(([n, s]) => `${n}: ${[...s].sort().join(", ")}`)));
  return pass(`${after.size} front(s) directly under fronts/, no placement newly collides`);
}

function materialize(data: DataSet): string {
  const dir = mkdtempSync(join(tmpdir(), "flatten-groups-"));
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

/** O4: check() over the result finds nothing new (a finding gone — doc-owner-outside-front on a group's own
 * README that is now a true front README, doc-meta-missing on a field just added — is fine). */
export function oracleCheckNoWorse(plan: Plan): OracleResult {
  const map: TargetMap = (p) => destPath(p, plan.dest);
  const text = textRewriter(plan.dest);
  const norm = (f: Finding, ref: (r: string) => string, docPath: (r: string) => string) => {
    let message = f.message;
    const link = f.code === "doc-link-broken" && message.match(/^links to (.+), which does not exist$/);
    if (link) message = `→ ${finalTarget(docPath(f.about), link[1]!, map)}`;
    else message = text(message);
    return JSON.stringify({ code: f.code, severity: f.severity, about: ref(f.about), message });
  };
  const refMap = (r: string) => refOf(destPath(`${r}.md`, plan.dest));
  const b = checkOf(plan.before).map((f) => norm(f, refMap, (r) => `${r}.md`));
  const a = checkOf(plan.after).map((f) => norm(f, (r) => r, (r) => `${r}.md`));
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

/** O5: every relative link of the original data names, after, the same file it named before. */
export function oracleLinksResolve(plan: Plan): OracleResult {
  const map: TargetMap = (p) => destPath(p, plan.dest);
  let n = 0;
  const problems: string[] = [];
  for (const [p, b] of plan.before.specs) {
    if (!isMd(p)) continue;
    const np = plan.moves.get(p) ?? p;
    const xs = linkTargets(txt(b).split("\n"));
    const ys = linkTargets(txt(plan.after.specs.get(np)).split("\n"));
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
  return problems.length ? fail(few(problems)) : pass(`${n} relative link(s) name the same file`);
}

/** O6: moved.json's every old key still answers in one step, every new value names a file (fronts-move.ts's
 * movedParity, reused). */
export function oracleMovedAnswers(plan: Plan): OracleResult {
  return movedParity(plan.before.moved, plan.after.moved!, plan.after.specs, plan.before.specs);
}

/** O7: a dry-run over the result finds no group left to promote. */
export function oracleIdempotent(plan: Plan): OracleResult {
  const again = planFlatten(plan.after);
  if (!nothingToDo(again)) return fail(`a second pass still finds ${again.groups.length} group(s), ${again.readmeFixes.size} readme fix(es), ${again.created.length} creation(s)`);
  return pass("a second dry-run over the result has nothing to do");
}

/** O1, O2, O3, O5, O6: structural, and true of any single pass on its own. O4 and O7 are not gated the
 * same way mid a multi-pass run (the CLI's run(), below): a group nested inside a group this very pass
 * promoted is still "outside its front" in check()'s eyes, and a further dry-run still finds it to do —
 * both are real, but only because a later pass resolves them, not because this pass did anything wrong.
 * run() checks O4 only once it knows a pass is the last one, and leaves O7 to its own loop condition. */
const STRUCTURAL_ORACLES: { name: string; run: (plan: Plan) => OracleResult }[] = [
  { name: "O1 nothing lost", run: oracleNothingLost },
  { name: "O2 metadata preserved", run: oracleMetaPreserved },
  { name: "O3 no new collision", run: oracleNoCollision },
  { name: "O5 links still resolve", run: oracleLinksResolve },
  { name: "O6 moved.json answers", run: oracleMovedAnswers },
];
const CHECK_ORACLE = { name: "O4 check() no worse", run: oracleCheckNoWorse };
const CORE_ORACLES = [...STRUCTURAL_ORACLES.slice(0, 3), CHECK_ORACLE, ...STRUCTURAL_ORACLES.slice(3)];
const ORACLES = [...CORE_ORACLES, { name: "O7 idempotent", run: oracleIdempotent }];

function runList(list: typeof ORACLES, plan: Plan): { name: string; result: OracleResult }[] {
  return list.map(({ name, run }) => {
    try {
      return { name, result: run(plan) };
    } catch (e) {
      return { name, result: fail(`threw: ${(e as Error).message}`) };
    }
  });
}

/** Every oracle, O7 included — a single-pass check (tests, ad hoc calls). The CLI's run(), below, checks
 * O1–O3/O5/O6 every pass but defers O4 to a pass's own lookahead and leaves O7 to its loop condition. */
export function runOracles(plan: Plan): { name: string; result: OracleResult }[] {
  return runList(ORACLES, plan);
}

// ── the CLI ──

export function summary(plan: Plan): string[] {
  const fronts = new Set(plan.groups.map((g) => g.frontDir)).size;
  const lines = [
    `${plan.groups.length} group(s) promoted from ${fronts} front(s); ${plan.moves.size} file(s) moved, ${plan.rewritten.size} file(s) with a link or mention rewritten`,
    `${[...plan.readmeFixes.values()].filter((f) => f.existingRef).length} README amended with an inherited field, ${plan.created.length} README created`,
  ];
  if (plan.selfMerge.size) lines.push(`${plan.selfMerge.size} group merged straight into the front already holding its exact name, no new front made`);
  if (plan.renumbered.length) {
    lines.push(`${plan.renumbered.length} group given a fresh number, its own colliding with an existing front or an earlier group:`);
    for (const r of plan.renumbered) lines.push(`  ${r.key}: ${r.from} → ${r.to}`);
  }
  return lines;
}

export function refusal(plan: Plan, outcomes: { name: string; result: OracleResult }[]): string | undefined {
  const failed = outcomes.filter((o) => !o.result.ok).map((o) => o.name);
  if (failed.length) return `an oracle failed (${failed.join(", ")}); nothing written`;
  if (plan.selfMergeConflicts.length) {
    return `a self-merging group also carries its own README, which would land on the front's; name it in --override ("<front-dir>/<group-dir>": "a free NNN-slug") to promote it separately instead: ${plan.selfMergeConflicts.join(", ")}; nothing written`;
  }
  if (plan.collisions.length) {
    return `an --override collided with a number already spoken for ("<front-dir>/<group-dir>": "a free NNN-slug"); nothing written:\n${plan.collisions
      .map((c) => `  ${c.num}: ${c.dirs.join(", ")}`)
      .join("\n")}`;
  }
  return undefined;
}

export function commitMessage(plan: Plan): { subject: string; body: string } {
  return { subject: "flatten-groups: every group a front of its own, directly under fronts/", body: summary(plan).join("\n") };
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

/** Writes the plan's result over the checkout: one commit with `.git`, a plain rename without. */
export async function apply(specsData: string, plan: Plan): Promise<void> {
  const specsDir = join(specsData, "specs");
  const removed = [...plan.before.specs.keys()].filter((p) => !plan.after.specs.has(p));
  const written = [...plan.after.specs].filter(([p, b]) => !plan.before.specs.get(p)?.equals(b)).map(([p]) => p);
  const repo = existsSync(join(specsData, ".git"));
  const batches = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  if (repo) {
    if (removed.length) for (const b of batches(removed)) await git(specsData, ["rm", "-q", "--", ...b.map((p) => `specs/${p}`)]);
  } else for (const p of removed) unlinkSync(join(specsDir, p));
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
  console.error("usage: flatten-groups.ts dry-run|migrate --specs-data <specs-data checkout> [--override <file.json | json>]");
  process.exit(2);
}

function parseArgs(argv: string[]): { specsData: string; override?: string } {
  let specsData: string | undefined;
  let override: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--specs-data") specsData = argv[++i];
    else if (argv[i] === "--override") override = argv[++i];
    else usage();
  }
  if (!specsData) usage();
  return { specsData, ...(override !== undefined ? { override } : {}) };
}

function printReport(plan: Plan, outcomes: { name: string; result: OracleResult }[]): boolean {
  for (const l of summary(plan)) console.log(l);
  for (const c of plan.collisions) console.log(`  collision: number ${c.num} — ${c.dirs.join(", ")}`);
  if (plan.selfMergeConflicts.length) console.log(`  self-merge conflict: ${plan.selfMergeConflicts.join(", ")}`);
  let ok = true;
  for (const { name, result } of outcomes) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${name} — ${result.detail}`);
    if (!result.ok) ok = false;
  }
  return ok;
}

/** dry-run and migrate's shared computation; returns the exit code. As many passes as a group nested
 * inside a group this very run just promoted needs — oracleIdempotent (O7) is exactly this loop's own
 * stopping condition, so each pass is checked on O1–O6 alone (O7 would legitimately still find work
 * while a deeper level remains) and, for migrate, committed on its own before the next pass starts. */
export async function run(cmd: "dry-run" | "migrate", specsData: string, overrideArg?: string): Promise<number> {
  const override = loadOverride(overrideArg);
  let current = readDataSet(specsData);
  let passes = 0;
  for (;;) {
    const plan = planFlatten(current, override);
    if (nothingToDo(plan)) {
      console.log(passes === 0 ? "nothing to do" : `done after ${passes} pass(es)`);
      return 0;
    }
    passes++;
    console.log(`\n── pass ${passes} ──`);
    const isLast = nothingToDo(planFlatten(plan.after));
    const outcomes = runList(STRUCTURAL_ORACLES, plan);
    if (isLast) outcomes.push(...runList([CHECK_ORACLE], plan));
    else console.log(`${CHECK_ORACLE.name} — deferred to the last pass (a group just promoted here is still nested in another)`);
    const ok = printReport(plan, outcomes);
    if (cmd === "dry-run") {
      if (!ok) return 1;
      current = plan.after;
      continue;
    }
    const why = refusal(plan, outcomes);
    if (why) {
      console.error(`migrate: ${why}`);
      return 1;
    }
    await apply(specsData, plan);
    console.log(`migrate: pass ${passes} written${existsSync(join(specsData, ".git")) ? " and committed" : ""}`);
    current = plan.after;
  }
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "dry-run" && cmd !== "migrate") usage();
  const { specsData, override } = parseArgs(rest);
  process.exit(await run(cmd, specsData, override));
}
