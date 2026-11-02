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
// 2. before moving anything: no promoted group's number may equal an existing front's number, nor another
//    promoted group's — an --override entry (keyed `<front-dir>/<group-dir>`, e.g. "08-misc/70-misc-extra",
//    valued the new "NNN-slug" to use instead) resolves the one it names. migrate refuses, listing every
//    collision still standing, when one has no override; dry-run only lists them, never refuses.
// 3. fronts/<front>/<group>/… → fronts/<group-or-its-override>/…; the front directory keeps whatever sat
//    directly in it (its own README.md and the files that were in no group) — gone entirely when nothing did.
// 4. every relative link and every bare `specs/fronts/<front>/<group>/` mention is rewritten: fronts-move.ts's
//    rewriteLines/rebaseLink/finalTarget, reused here, never reimplemented.
// 5. moved.json gains `<old ref> → <new ref>` per promoted document, chains collapsed (fronts-move.ts's
//    collapse, reused).
// 6. a promoted group's own README, when it had none of its own and inherited milestone/owner from its front's
//    README (load.ts's placeOf), gets them written explicitly — merged into what it already has (never
//    overwritten), a minimal README created when the group had none.
//
// Seven oracles, all run in dry-run; migrate writes only when every one passes:
//   O1 nothing lost, O2 metadata preserved, O3 no new collision, O4 check() no worse, O5 links still resolve,
//   O6 moved.json answers, O7 idempotent (a dry-run of the result has nothing to do).
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

function destOf(groups: GroupInfo[], override: Map<string, string>): Map<string, string> {
  return new Map(groups.map((g) => [g.key, override.get(g.key) ?? g.groupDir]));
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

/** Every front number that more than one directory would hold, `dest` applied. */
function collisionsOf(frontDirs: Set<string>, dest: Map<string, string>): Collision[] {
  const byNum = numbersOf([...frontDirs, ...dest.values()]);
  return [...byNum]
    .filter(([, dirs]) => dirs.size > 1)
    .map(([num, dirs]) => ({ num, dirs: [...dirs].sort() }))
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

function readmeFixesOf(groups: GroupInfo[], dest: Map<string, string>): Map<string, ReadmeFix> {
  const out = new Map<string, ReadmeFix>();
  for (const g of groups) {
    const readme = g.docs.find((d) => d.name === "README");
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
  /** Front numbers more than one directory would hold, `dest` applied — migrate refuses while any stand. */
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
  const dest = destOf(groups, override);
  const collisions = collisionsOf(frontDirs, dest);
  const readmeFixes = readmeFixesOf(groups, dest);

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
  return { before: data, groups, dest, collisions, readmeFixes, moves, rewritten, created, amended, after };
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

/** O3: no front number sits on more than one directory directly under fronts/, after. */
export function oracleNoCollision(plan: Plan): OracleResult {
  const dirs = new Set<string>();
  for (const p of plan.after.specs.keys()) {
    const parts = p.split("/");
    if (parts[0] === FRONTS_DIR && parts[1]) dirs.add(parts[1]);
  }
  const byNum = numbersOf(dirs);
  const dup = [...byNum].filter(([, s]) => s.size > 1);
  if (dup.length) return fail(few(dup.map(([n, s]) => `${n}: ${[...s].sort().join(", ")}`)));
  return pass(`${dirs.size} front(s) directly under fronts/, every number unique`);
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

const ORACLES: { name: string; run: (plan: Plan) => OracleResult }[] = [
  { name: "O1 nothing lost", run: oracleNothingLost },
  { name: "O2 metadata preserved", run: oracleMetaPreserved },
  { name: "O3 no new collision", run: oracleNoCollision },
  { name: "O4 check() no worse", run: oracleCheckNoWorse },
  { name: "O5 links still resolve", run: oracleLinksResolve },
  { name: "O6 moved.json answers", run: oracleMovedAnswers },
  { name: "O7 idempotent", run: oracleIdempotent },
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

export function summary(plan: Plan): string[] {
  const fronts = new Set(plan.groups.map((g) => g.frontDir)).size;
  return [
    `${plan.groups.length} group(s) promoted from ${fronts} front(s); ${plan.moves.size} file(s) moved, ${plan.rewritten.size} file(s) with a link or mention rewritten`,
    `${[...plan.readmeFixes.values()].filter((f) => f.existingRef).length} README amended with an inherited field, ${plan.created.length} README created`,
  ];
}

export function refusal(plan: Plan, outcomes: { name: string; result: OracleResult }[]): string | undefined {
  const failed = outcomes.filter((o) => !o.result.ok).map((o) => o.name);
  if (failed.length) return `an oracle failed (${failed.join(", ")}); nothing written`;
  if (plan.collisions.length) {
    return `colliding front number(s), name the group(s) in --override ("<front-dir>/<group-dir>": "a free NNN-slug"); nothing written:\n${plan.collisions
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
  if (nothingToDo(plan)) console.log("nothing to do");
  for (const l of summary(plan)) console.log(l);
  for (const c of plan.collisions) console.log(`  collision: number ${c.num} — ${c.dirs.join(", ")}`);
  let ok = true;
  for (const { name, result } of outcomes) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${name} — ${result.detail}`);
    if (!result.ok) ok = false;
  }
  return ok;
}

/** dry-run and migrate's shared computation; returns the exit code. */
export async function run(cmd: "dry-run" | "migrate", specsData: string, overrideArg?: string): Promise<number> {
  const plan = planFlatten(readDataSet(specsData), loadOverride(overrideArg));
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
  const { specsData, override } = parseArgs(rest);
  process.exit(await run(cmd, specsData, override));
}
