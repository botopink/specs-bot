#!/usr/bin/env bun
// Splits the old flat pair — decisions-taken-steps.md (the numbered record) and decisions-taken.md (one `##
// <slug>` subject per group, its prose) — into the decisions-taken/ directory layout group.ts already reads:
// a README.md index plus one <slug>.md per group, each holding its subject's prose and its own `## Record`
// table side by side (decision: the maintainer, "decisions-record-split").
//
//   bun scripts/split-record.ts dry-run --specs-data <specs-data checkout> [--override <file.json>]
//   bun scripts/split-record.ts migrate --specs-data <specs-data checkout> [--override <file.json>]
//
// Ownership rule, for every row of decisions-taken-steps.md: 0 subjects whose `Steps:` line cites the row's
// number → "unfiled"; 1 → that subject; 2+ → the first of them in decisions-taken.md's own order (top to
// bottom) — never the row's own position, since the rows are grouped by subject already and read out of
// number order. --override (a JSON object, `{"337": "some-slug"}`) replaces the rule's answer for the numbers
// it names, whatever the rule alone would have said.
//
// dry-run computes the split and prints it — the groups, the citation-count counts, the cross-group
// supersede pairs (information for whoever reviews the ledger next, not something this script fixes) and the
// six oracles below (PASS/FAIL) — and writes nothing. migrate runs the same computation and the same oracles
// first; on any oracle failure it aborts (a non-zero exit) without writing a single file. Only once every
// oracle passes does it write decisions-taken/README.md and one file per group, and remove the old pair — ``git
// rm`` + ``git commit`` when <specs-data checkout> is a git repository (`.git` exists at its root), a plain
// `unlink` otherwise.
//
// This piece writes and tests the computation and both CLI paths; migrate's git branch is written and typed but
// exercised in this piece's own tests only against a checkout with no `.git` (the plain-unlink path) — running
// it against a real specs-data checkout, `.git` included, is the next piece's to do.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, type Finding } from "../packages/core/src/check.ts";
import { parseGroup, parseRecordReadme, type GroupDoc } from "../packages/core/src/decisions/group.ts";
import { parsePending } from "../packages/core/src/decisions/pending.ts";
import { parseRetired } from "../packages/core/src/decisions/retired.ts";
import { formatStepRow, nextFree, parseSteps, type StepRow, type StepsDoc } from "../packages/core/src/decisions/steps.ts";
import { parseTaken, type Subject, type TakenDoc } from "../packages/core/src/decisions/taken.ts";
import { placeDocs } from "../packages/core/src/docs/load.ts";
import { renderLedger } from "../packages/core/src/ledger.ts";
import { buildModel } from "../packages/core/src/model.ts";
import { units, type Unit } from "../packages/core/src/search.ts";
import { groupFilesOnDisk, type Store } from "../packages/core/src/store.ts";
import { git } from "../packages/core/src/write/git.ts";

// ── the split itself ──

export interface SplitCounts {
  /** Rows with no subject citing them → unfiled. */
  zero: number;
  /** Rows exactly one subject cites. */
  one: number;
  /** Rows two or more subjects cite (the first, in decisions-taken.md's order, wins). */
  many: number;
  /** Of the rows --override names, how many it actually changed (its answer differs from the rule's own). */
  overridden: number;
}

export interface CrossGroupSupersede {
  /** The superseded row's number (its status is overtaken/replaced/reversed, pointing at `to`). */
  from: number;
  /** The row `from` names in "Overtaken by N" / "Replaced by N" / "Reversed by N". */
  to: number;
  fromGroup: string;
  toGroup: string;
}

export interface SplitResult {
  /** Every row's number → the slug of the group it lands in ("unfiled" included). */
  ownerOf: Map<number, string>;
  /** The final groups, in the order decisions-taken.md's subjects stand, "unfiled" last if any row uses it. */
  groups: string[];
  /** Each group's full file text (group.ts's shape: "# slug — summary" + prose + "## Record" + its rows). */
  groupText: Map<string, string>;
  /** decisions-taken/README.md's text. */
  readmeText: string;
  counts: SplitCounts;
  /** Not corrected — information for whoever reads the split next about which supersede pairs now cross a
   * group boundary (the superseded row's file is no longer the superseding row's). */
  crossGroupSupersedes: CrossGroupSupersede[];
}

/**
 * The whole split, computed from the two files' text alone — no disk access here, every other function this
 * script defines besides the CLI itself takes data already in memory and returns data, never a path.
 */
export function planSplit(stepsText: string, takenText: string, override: Map<number, string> = new Map()): SplitResult {
  const steps = parseSteps(stepsText);
  const taken = parseTaken(takenText);

  const ownerOf = new Map<number, string>();
  const counts: SplitCounts = { zero: 0, one: 0, many: 0, overridden: 0 };
  for (const row of steps.rows) {
    const citing = taken.subjects.filter((s) => s.steps.includes(row.num));
    if (citing.length === 0) counts.zero++;
    else if (citing.length === 1) counts.one++;
    else counts.many++;
    const byRule = citing.length === 0 ? "unfiled" : citing[0]!.slug;
    const final = override.has(row.num) ? override.get(row.num)! : byRule;
    if (override.has(row.num) && final !== byRule) counts.overridden++;
    ownerOf.set(row.num, final);
  }

  const groups = taken.subjects.map((s) => s.slug);
  if ([...ownerOf.values()].includes("unfiled")) groups.push("unfiled");

  const rowsOf = new Map<string, StepRow[]>();
  for (const row of steps.rows) {
    const slug = ownerOf.get(row.num)!;
    const list = rowsOf.get(slug);
    if (list) list.push(row);
    else rowsOf.set(slug, [row]);
  }
  for (const list of rowsOf.values()) list.sort((a, b) => a.num - b.num);

  const groupText = new Map<string, string>();
  for (const slug of groups) {
    const rows = rowsOf.get(slug) ?? [];
    const subject = taken.subjects.find((s) => s.slug === slug);
    groupText.set(slug, subject ? subjectGroupText(subject, rows) : unfiledGroupText(rows));
  }

  const readmeText = readmeTextOf(groups, nextFree(steps));

  const crossGroupSupersedes: CrossGroupSupersede[] = [];
  for (const row of steps.rows) {
    if (row.supersededBy === undefined) continue;
    const other = steps.rows.find((r) => r.num === row.supersededBy);
    if (!other) continue; // step-superseded-by-missing: check.ts's to report, not this script's to count.
    const fromGroup = ownerOf.get(row.num)!;
    const toGroup = ownerOf.get(other.num)!;
    if (fromGroup !== toGroup) crossGroupSupersedes.push({ from: row.num, to: other.num, fromGroup, toGroup });
  }

  return { ownerOf, groups, groupText, readmeText, counts, crossGroupSupersedes };
}

function subjectGroupText(s: Subject, rows: StepRow[]): string {
  const lines = [`# ${s.slug} — ${s.summary}`, ""];
  if (s.lead) lines.push(`**${s.lead}**`, "");
  for (const p of s.paragraphs) lines.push(p, "");
  const tail: string[] = [];
  if (s.steps.length) tail.push(`Steps: ${s.steps.join(", ")}`);
  if (s.binds) tail.push(`Binds: ${s.binds}`);
  if (tail.length) lines.push(...tail, "");
  lines.push("## Record", "", "| # | Id | Rule in force | Binds | Cell |", "|---|---|---|---|---|", ...rows.map((r) => formatStepRow(r)));
  return `${lines.join("\n")}\n`;
}

function unfiledGroupText(rows: StepRow[]): string {
  const lines = [
    "# unfiled — decisions no subject cites",
    "",
    "## Record",
    "",
    "| # | Id | Rule in force | Binds | Cell |",
    "|---|---|---|---|---|",
    ...rows.map((r) => formatStepRow(r)),
  ];
  return `${lines.join("\n")}\n`;
}

function readmeTextOf(groups: string[], next: number): string {
  const lines = ["# Decisions taken", "", `The record. **The next free number is ${next}.**`, "", "## Groups", "", ...groups.map((g) => `- ${g}`)];
  return `${lines.join("\n")}\n`;
}

// ── a Store in memory, for the oracles that need check()/units()/buildModel() ──

/**
 * A group's prose as a `Subject`. Duplicated from store.ts's own (unexported) `loadRecord` helper: that function
 * stays private to loadStore's own aggregation, and the four-line body is cheaper to copy here than to grow
 * store.ts's public surface for a script-only need (the task's own call, § "A tarefa").
 */
function groupToSubject(g: GroupDoc): Subject {
  return { slug: g.slug, summary: g.summary, lead: g.lead, paragraphs: g.paragraphs, steps: g.steps, binds: g.binds, lines: g.lines.slice(0, g.proseEnd), line: 0 };
}

/** A Store holding only steps/taken (and, when given, record) — the rest check()/units() need but this script
 * never changes (pending, retired, the doc tree, chat) stay empty in every Store this script builds. */
function bareStore(parts: Pick<Store, "steps" | "taken"> & Pick<Partial<Store>, "record">): Store {
  return { specsDir: "/synthetic", pending: parsePending(""), retired: parseRetired(""), tree: placeDocs([]), chat: [], ...parts };
}

function flatStore(steps: StepsDoc, taken: TakenDoc): Store {
  return bareStore({ steps, taken });
}

/** Reassembles a Store the way store.ts's loadRecord does, from the split's own output (already computed, no
 * disk access): steps.rows is every group's rows with `section` rewritten to the group's slug, taken.subjects
 * is one Subject per group that carries prose. */
function newStoreOf(result: SplitResult): Store {
  const readme = parseRecordReadme(result.readmeText);
  const groups = new Map<string, GroupDoc>();
  for (const slug of readme.order) {
    const text = result.groupText.get(slug);
    if (text) groups.set(slug, parseGroup(text, slug));
  }
  const rows: StepRow[] = [];
  const subjects: Subject[] = [];
  for (const slug of readme.order) {
    const g = groups.get(slug);
    if (!g) continue;
    for (const row of g.rows) rows.push({ ...row, section: slug });
    if (g.lead || g.paragraphs.length || g.steps.length || g.binds) subjects.push(groupToSubject(g));
  }
  const steps: StepsDoc = { lines: [], rows, ...(readme.statedNextFree !== undefined ? { statedNextFree: readme.statedNextFree } : {}) };
  const taken: TakenDoc = { lines: [], head: [], subjects };
  return bareStore({ steps, taken, record: { readme, groups } });
}

/**
 * check(), safe to call on a Store whose `record` this script built in memory. check.ts's own checkRecord reads
 * decisions-taken/ off disk (groupFilesOnDisk) to flag a file the README does not list — meaningful once migrate
 * has written the directory, meaningless for a plan nothing has written yet. The one disk access in this whole
 * script's oracle suite: a throwaway temp directory holding exactly the files `store.record` already lists (so
 * checkRecord finds no discrepancy — the files it would compare against are definitionally the same map),
 * written and removed around the one call. planSplit() itself, and every oracle but this plumbing, stays off disk.
 */
function checkInMemory(store: Store): Finding[] {
  if (!store.record) return check(store);
  const dir = mkdtempSync(join(tmpdir(), "split-record-check-"));
  try {
    const recordDir = join(dir, "specs", "decisions-taken");
    mkdirSync(recordDir, { recursive: true });
    for (const [slug, g] of store.record.groups) writeFileSync(join(recordDir, `${slug}.md`), g.lines.join("\n"));
    return check({ ...store, specsDir: join(dir, "specs") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── the six oracles ──

export interface OracleInput {
  steps: StepsDoc;
  taken: TakenDoc;
}

export interface OracleResult {
  ok: boolean;
  detail: string;
}

function countBy(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** 1. The multiset of every row's formatStepRow(), across all groups, equals the original's. */
export function oracleRowMultiset(orig: OracleInput, result: SplitResult): OracleResult {
  const want = countBy(orig.steps.rows.map((r) => formatStepRow(r)));
  const got = countBy(result.groups.flatMap((slug) => parseGroup(result.groupText.get(slug)!, slug).rows.map((r) => formatStepRow(r))));
  const missing: string[] = [];
  for (const [k, n] of want) if ((got.get(k) ?? 0) !== n) missing.push(`${k} (want ${n}, got ${got.get(k) ?? 0})`);
  const extra: string[] = [];
  for (const [k, n] of got) if (!want.has(k)) extra.push(`${k} (got ${n})`);
  if (!missing.length && !extra.length) {
    return { ok: true, detail: `${[...want.values()].reduce((a, b) => a + b, 0)} row(s) match exactly across groups` };
  }
  return { ok: false, detail: `row mismatch — wrong/missing: ${missing.join("; ") || "none"}; unexpected: ${extra.join("; ") || "none"}` };
}

/** 2. Every original Subject's prose (lead/paragraphs/steps/binds) reread from its group file, unchanged. */
export function oracleProseFidelity(orig: OracleInput, result: SplitResult): OracleResult {
  const problems: string[] = [];
  for (const s of orig.taken.subjects) {
    const text = result.groupText.get(s.slug);
    if (!text) {
      problems.push(`${s.slug}: no group file produced`);
      continue;
    }
    const g = parseGroup(text, s.slug);
    if (g.lead !== s.lead) problems.push(`${s.slug}: lead differs ("${g.lead}" vs "${s.lead}")`);
    if (JSON.stringify(g.paragraphs) !== JSON.stringify(s.paragraphs)) problems.push(`${s.slug}: paragraphs differ`);
    if (JSON.stringify(g.steps) !== JSON.stringify(s.steps)) problems.push(`${s.slug}: steps differ`);
    if (g.binds !== s.binds) problems.push(`${s.slug}: binds differ ("${g.binds}" vs "${s.binds}")`);
  }
  if (!problems.length) return { ok: true, detail: `${orig.taken.subjects.length} subject(s) reread with identical prose` };
  return { ok: false, detail: problems.join("; ") };
}

/** 3. check() over a Store built from the new layout finds the same, bar next-free-mismatch's `about`. */
export function oracleCheckParity(orig: OracleInput, result: SplitResult): OracleResult {
  const normalize = (fs: Finding[]) =>
    fs.map((f) => JSON.stringify(f.code === "next-free-mismatch" ? { ...f, about: "" } : f)).sort();
  const a = normalize(checkInMemory(flatStore(orig.steps, orig.taken)));
  const b = normalize(checkInMemory(newStoreOf(result)));
  if (JSON.stringify(a) === JSON.stringify(b)) return { ok: true, detail: `${a.length} finding(s), identical` };
  const onlyOrig = a.filter((x) => !b.includes(x));
  const onlyNew = b.filter((x) => !a.includes(x));
  return {
    ok: false,
    detail: `findings differ — only on the original: ${onlyOrig.join(" | ") || "none"}; only on the new layout: ${onlyNew.join(" | ") || "none"}`,
  };
}

/** 4. The next free number agrees everywhere: the new README, the new rows, the original rows. */
export function oracleNextFree(orig: OracleInput, result: SplitResult): OracleResult {
  const readme = parseRecordReadme(result.readmeText);
  const fromReadme = readme.statedNextFree;
  const newRows = result.groups.flatMap((slug) => parseGroup(result.groupText.get(slug)!, slug).rows);
  const fromNew = nextFree({ lines: [], rows: newRows });
  const fromOrig = nextFree(orig.steps);
  if (fromReadme === fromNew && fromNew === fromOrig) return { ok: true, detail: `next free is ${fromOrig} everywhere` };
  return { ok: false, detail: `next free disagrees — README says ${fromReadme}, the new rows make it ${fromNew}, the original rows make it ${fromOrig}` };
}

/** 5. units() over the old and the new Store agree on every step/subject unit (file may differ). */
export function oracleUnitsParity(orig: OracleInput, result: SplitResult): OracleResult {
  const strip = (u: Unit) => ({ id: u.id, kind: u.kind, key: u.key, title: u.title, text: u.text });
  const a = units(flatStore(orig.steps, orig.taken))
    .filter((u) => u.kind === "step" || u.kind === "subject")
    .map(strip)
    .sort((x, y) => x.id.localeCompare(y.id));
  const b = units(newStoreOf(result))
    .filter((u) => u.kind === "step" || u.kind === "subject")
    .map(strip)
    .sort((x, y) => x.id.localeCompare(y.id));
  if (JSON.stringify(a) === JSON.stringify(b)) return { ok: true, detail: `${a.length} step/subject unit(s) match` };
  const byId = new Map(b.map((u) => [u.id, u]));
  const diffs = a.filter((u) => JSON.stringify(byId.get(u.id)) !== JSON.stringify(u)).map((u) => u.id);
  const onlyA = a.filter((u) => !byId.has(u.id)).map((u) => u.id);
  const onlyB = b.filter((u) => !a.some((x) => x.id === u.id)).map((u) => u.id);
  return { ok: false, detail: `unit(s) differ: ${diffs.join(", ") || "none"}; only original: ${onlyA.join(", ") || "none"}; only new: ${onlyB.join(", ") || "none"}` };
}

/** 6. parseSteps(renderLedger(buildModel(newStore))).rows matches the new store's own steps.rows, line aside. */
export function oracleRenderLedgerRoundtrip(_orig: OracleInput, result: SplitResult): OracleResult {
  const model = buildModel(newStoreOf(result));
  const rendered = renderLedger(model);
  const strip = (r: StepRow) => {
    const { line: _line, ...rest } = r;
    return rest;
  };
  const a = [...parseSteps(rendered).rows].sort((x, y) => x.num - y.num).map(strip);
  const b = [...model.steps.rows].sort((x, y) => x.num - y.num).map(strip);
  if (JSON.stringify(a) === JSON.stringify(b)) return { ok: true, detail: `${a.length} row(s) round-trip through renderLedger` };
  return { ok: false, detail: `renderLedger round trip differs (${a.length} vs ${b.length} row(s), or a field mismatch)` };
}

export interface NamedOracle {
  name: string;
  run: (orig: OracleInput, result: SplitResult) => OracleResult;
}

export const ORACLES: NamedOracle[] = [
  { name: "row multiset preserved", run: oracleRowMultiset },
  { name: "subject prose fidelity", run: oracleProseFidelity },
  { name: "check() parity", run: oracleCheckParity },
  { name: "next-free consistency", run: oracleNextFree },
  { name: "units() parity", run: oracleUnitsParity },
  { name: "renderLedger round trip", run: oracleRenderLedgerRoundtrip },
];

export function runOracles(orig: OracleInput, result: SplitResult): { name: string; result: OracleResult }[] {
  return ORACLES.map(({ name, run }) => ({ name, result: run(orig, result) }));
}

// ── the CLI ──

function usage(): never {
  console.error(
    "usage: split-record.ts dry-run --specs-data <specs-data checkout> [--override <file.json>] | migrate --specs-data <specs-data checkout> [--override <file.json>]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { specsData: string; overridePath?: string } {
  let specsData: string | undefined;
  let overridePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--specs-data") specsData = argv[++i];
    else if (argv[i] === "--override") overridePath = argv[++i];
    else usage();
  }
  if (!specsData) usage();
  return { specsData, ...(overridePath !== undefined ? { overridePath } : {}) };
}

function loadOverride(path?: string): Map<number, string> {
  if (!path) return new Map();
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  return new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
}

function readRecordFiles(specsData: string): { stepsText: string; takenText: string } {
  const specs = join(specsData, "specs");
  return {
    stepsText: readFileSync(join(specs, "decisions-taken-steps.md"), "utf8"),
    takenText: readFileSync(join(specs, "decisions-taken.md"), "utf8"),
  };
}

export function plan(specsData: string, overridePath?: string): { result: SplitResult; outcomes: { name: string; result: OracleResult }[] } {
  const { stepsText, takenText } = readRecordFiles(specsData);
  const override = loadOverride(overridePath);
  const result = planSplit(stepsText, takenText, override);
  const orig: OracleInput = { steps: parseSteps(stepsText), taken: parseTaken(takenText) };
  return { result, outcomes: runOracles(orig, result) };
}

/** Prints the counts and the oracle outcomes; returns whether every oracle passed. */
function printReport(result: SplitResult, outcomes: { name: string; result: OracleResult }[]): boolean {
  console.log(`${result.groups.length} group(s): ${result.groups.join(", ")}`);
  console.log(
    `rows by citation count — 0 (unfiled): ${result.counts.zero}, 1: ${result.counts.one}, 2+: ${result.counts.many}; override changed: ${result.counts.overridden}`,
  );
  if (result.crossGroupSupersedes.length) {
    console.log(`${result.crossGroupSupersedes.length} supersede pair(s) now cross a group boundary:`);
    for (const c of result.crossGroupSupersedes) console.log(`  ${c.from} (${c.fromGroup}) -> ${c.to} (${c.toGroup})`);
  } else {
    console.log("0 supersede pair(s) cross a group boundary");
  }
  let ok = true;
  for (const { name, result: r } of outcomes) {
    console.log(`${r.ok ? "PASS" : "FAIL"} ${name} — ${r.detail}`);
    if (!r.ok) ok = false;
  }
  return ok;
}

export function dryRun(specsData: string, overridePath?: string): void {
  const { result, outcomes } = plan(specsData, overridePath);
  const ok = printReport(result, outcomes);
  process.exit(ok ? 0 : 1);
}

export async function migrate(specsData: string, overridePath?: string): Promise<void> {
  const { result, outcomes } = plan(specsData, overridePath);
  const ok = printReport(result, outcomes);
  if (!ok) {
    console.error("migrate: an oracle failed; nothing written");
    process.exit(1);
  }

  const specs = join(specsData, "specs");
  const recordDir = join(specs, "decisions-taken");
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, "README.md"), result.readmeText);
  for (const slug of result.groups) writeFileSync(join(recordDir, `${slug}.md`), result.groupText.get(slug)!);

  const stepsFile = join(specs, "decisions-taken-steps.md");
  const takenFile = join(specs, "decisions-taken.md");
  if (existsSync(join(specsData, ".git"))) {
    await git(specsData, ["add", "specs/decisions-taken"]);
    await git(specsData, ["rm", "--", "specs/decisions-taken-steps.md", "specs/decisions-taken.md"]);
    await git(specsData, ["commit", "-m", "decisions-taken: split the flat pair into decisions-taken/, one file per group"]);
  } else {
    unlinkSync(stepsFile);
    unlinkSync(takenFile);
  }
  console.log(`migrate: wrote decisions-taken/README.md + ${result.groups.length} group file(s); removed the old pair`);
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const { specsData, overridePath } = parseArgs(rest);
  if (cmd === "dry-run") dryRun(specsData, overridePath);
  else if (cmd === "migrate") await migrate(specsData, overridePath);
  else usage();
}
