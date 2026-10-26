#!/usr/bin/env bun
// Flatten specs-data (2026-10-26): specs/<version>/[machine-N/]<group>/<leaf>/… → specs/<front>/…, the milestone's
// own documents → specs/milestone/, version and machine as `**Milestone:**` / `**Machine:**` fields in each
// front's README.
//
//   bun scripts/flatten.ts migrate <specs-data checkout> <permalink sha> <map.json out>
//   bun scripts/flatten.ts rewrite <specs-data checkout before> <file>…   (another repository's files, in place)
//
// A numbered unit (a group under a version or machine, or a leaf under a group) keeps only its newest copy; a
// tie inside one version goes to the deeper one. A unit lands under the new home of its parent's newest copy, so
// a superseded group's surviving leaves follow it. Old milestones' own documents are dropped (the git history
// keeps them). Every path in the data is rewritten by the map: markdown links relative to the new location (a
// dropped target becomes a permalink at <sha>), bare paths in text in the form they were written. moved.json at
// the data root maps every old document ref to its ref now (or the permalink), for the api and the site.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

const VERSION = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;
const NUM = /^\d+-[\w.-]+$/;

interface Unit {
  name: string;
  version: string;
  machine?: string;
  depth: 1 | 2;
  /** Path under specs/: a folder, or a single-file front's .md. */
  old: string;
  parent?: Unit;
}

function vcmp(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : -1) : 1;
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
    if (d !== 0) return d;
  }
  return 0;
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const sorted = (xs: Iterable<string>) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else if (e.isFile()) yield p;
  }
}

/** The map of one specs-data checkout in the old layout. */
export function planFlatten(data: string, sha: string) {
  const SPECS = join(data, "specs");
  const PERMALINK = `https://github.com/botopink/specs-data/blob/${sha}/specs/`;
  const versions = readdirSync(SPECS).filter((d) => VERSION.test(d)).sort(vcmp);
  const current = versions.at(-1)!;
  const unitName = (e: string) => (e.endsWith(".md") ? e.slice(0, -3) : e);

  // ── units ──
  const units: Unit[] = [];
  for (const v of versions) {
    const bases: [string | undefined, string][] = [[undefined, v]];
    for (const m of sorted(readdirSync(join(SPECS, v)))) if (m.startsWith("machine-")) bases.push([m, `${v}/${m}`]);
    for (const [m, base] of bases) {
      for (const g of sorted(readdirSync(join(SPECS, base)))) {
        if (!NUM.test(unitName(g)) || !(g.endsWith(".md") || isDir(join(SPECS, base, g)))) continue;
        const gu: Unit = { name: unitName(g), version: v, depth: 1, old: `${base}/${g}`, ...(m ? { machine: m } : {}) };
        units.push(gu);
        if (!isDir(join(SPECS, base, g))) continue;
        for (const leaf of sorted(readdirSync(join(SPECS, base, g)))) {
          if (NUM.test(leaf) && isDir(join(SPECS, base, g, leaf))) {
            units.push({ name: leaf, version: v, depth: 2, old: `${base}/${g}/${leaf}`, parent: gu, ...(m ? { machine: m } : {}) });
          }
        }
      }
    }
  }

  // The newest copy of each name; a tie goes to the deeper one, then to a folder over its single-file twin.
  const rank = (u: Unit, w: Unit) => vcmp(u.version, w.version) || u.depth - w.depth || Number(!u.old.endsWith(".md")) - Number(!w.old.endsWith(".md"));
  const winner = new Map<string, Unit>();
  for (const u of units) {
    const w = winner.get(u.name);
    if (!w || rank(u, w) > 0) winner.set(u.name, u);
  }
  /** u's surviving copy: its name's newest, unless that is u's own child of that name (a front wrapping its namesake). */
  const win = (u: Unit): Unit => {
    const w = winner.get(u.name)!;
    return w === u || w.parent === u ? u : w;
  };
  const isTwin = (w: Unit, u: Unit) => w !== u && w.version === u.version && w.depth === u.depth;
  const homes = new Map<Unit, string>();
  const home = (u: Unit): string => {
    let h = homes.get(u);
    if (h === undefined) {
      h = u.parent ? `${home(win(u.parent))}/${u.name}` : u.name;
      homes.set(u, h);
    }
    return h;
  };

  // ── the file map ──
  const owner = (path: string): Unit | undefined => {
    let best: Unit | undefined;
    for (const u of units) {
      if ((path === u.old || path.startsWith(`${u.old}/`)) && (!best || u.old.length > best.old.length)) best = u;
    }
    return best;
  };
  const fileMap = new Map<string, string | null>();
  for (const v of versions) {
    for (const file of walkFiles(join(SPECS, v))) {
      const old = posix.relative(SPECS, file);
      const u = owner(old);
      if (u) {
        const w = win(u);
        if (w !== u && !isTwin(w, u)) fileMap.set(old, null);
        else if (u.old.endsWith(".md")) fileMap.set(old, `${home(w)}/README.md`);
        else fileMap.set(old, `${home(w)}/${old.slice(u.old.length + 1)}`);
      } else if (v === current) {
        const rest = old.slice(v.length + 1);
        // The milestone's documents; a machine's own README becomes milestone/machine-N.md.
        const m = rest.match(/^(machine-\d+)\/README\.md$/);
        fileMap.set(old, m ? `milestone/${m[1]}.md` : `milestone/${rest}`);
      } else {
        fileMap.set(old, null);
      }
    }
  }
  const targets = new Map<string, string[]>();
  for (const [o, n] of fileMap) if (n) targets.set(n, [...(targets.get(n) ?? []), o]);
  const clashes = [...targets].filter(([, os]) => os.length > 1);
  if (clashes.length) throw new Error(`two files land on one path:\n${clashes.map(([n, os]) => `  ${n} ← ${os.join(", ")}`).join("\n")}`);

  // Folders map too (a path may name one).
  const dirMap = new Map<string, string | null>();
  for (const u of units) {
    if (u.old.endsWith(".md")) continue;
    const w = win(u);
    dirMap.set(u.old, w === u || isTwin(w, u) ? home(w) : null);
  }
  const unitDirs = new Set(dirMap.keys()); // a path inside a unit maps by it; a version's folder holds no unknown paths
  for (const v of versions) {
    dirMap.set(v, v === current ? "milestone" : null);
    for (const m of readdirSync(join(SPECS, v))) if (m.startsWith("machine-")) dirMap.set(`${v}/${m}`, v === current ? "milestone" : null);
  }

  /** An old path under specs/ (a file or a folder) → [its path now or null when dropped, whether it is known]. */
  const mapPath = (p0: string): [string | null, boolean] => {
    const p = p0.replace(/\/+$/, "");
    if (!p.includes("/") && existsSync(join(SPECS, p)) && statSync(join(SPECS, p)).isFile()) return [p, true]; // the decision files
    if (fileMap.has(p)) return [fileMap.get(p)!, true];
    if (dirMap.has(p)) return [dirMap.get(p)!, true];
    if (fileMap.has(`${p}.md`)) {
      const n = fileMap.get(`${p}.md`)!; // a ref without .md (the site's and the CLI's form)
      return [n ? n.slice(0, -3) : null, true];
    }
    const parts = p.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const d = parts.slice(0, i).join("/");
      if (unitDirs.has(d)) {
        const to = dirMap.get(d);
        return [to ? `${to}/${parts.slice(i).join("/")}` : null, true];
      }
    }
    return [null, false];
  };

  // Each winner's README gets its milestone and machine.
  const readmeFields = new Map<string, [string, string | undefined]>();
  for (const u of units) if (win(u) === u) readmeFields.set(`${home(u)}/README.md`, [u.version, u.machine]);

  return { SPECS, PERMALINK, versions, current, fileMap, dirMap, mapPath, readmeFields };
}

export type Flatten = ReturnType<typeof planFlatten>;

// ── the front fields ──
export function addFields(text: string, version: string, machine?: string): string {
  const lines = text.split("\n");
  const fields = [`**Milestone:** ${version}`, ...(machine ? [`**Machine:** ${machine}`] : [])];
  let i = 0;
  if (lines[0] === "---") i = lines.indexOf("---", 1) + 1; // frontmatter
  while (i < lines.length && !lines[i]!.startsWith("# ")) i++;
  if (i === lines.length) return `${fields.join("\n")}\n\n${text}`;
  let j = i + 1;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  if (j < lines.length && /^\*\*[^*]+:\*\*/.test(lines[j]!)) return [...lines.slice(0, j), ...fields, ...lines.slice(j)].join("\n");
  return [...lines.slice(0, i + 1), "", ...fields, ...lines.slice(i + 1)].join("\n");
}

// ── the rewrite ──
const LINK = /(\]\()([^)\s]+)(\))/g;
const VPATH = String.raw`\d+\.\d+\.\d+-[a-z0-9.]+`;
const BARE = new RegExp(
  String.raw`(?<![\w./-])(specs/)?((?:${VPATH})(?:/[\w.*-]+)*/?|machine-\d+/\d+-[\w.-]+(?:/[\w.*-]+)*/?|machine-\d+/README(?:\.md)?)`,
  "g",
);

export class Rewriter {
  stats = new Map<string, number>();
  constructor(readonly f: Flatten) {}

  #count(k: string) {
    this.stats.set(k, (this.stats.get(k) ?? 0) + 1);
  }

  bare(text: string, docVersion: string): string {
    return text.replace(BARE, (whole, prefix: string | undefined, p0: string) => {
      let p = p0;
      let trail = "";
      while (p && ".,;:".includes(p.at(-1)!)) {
        trail = p.at(-1)! + trail;
        p = p.slice(0, -1);
      }
      if (!p.includes("/")) {
        this.#count("bare kept"); // a version named in prose, not a path
        return whole;
      }
      const full = VERSION.test(p.split("/")[0]!) ? p : `${docVersion}/${p}`;
      const [to, known] = this.f.mapPath(full);
      if (!known || to === null) {
        this.#count("bare kept");
        return whole;
      }
      this.#count("bare rewritten");
      return (prefix ?? "") + to + (p.endsWith("/") && !to.endsWith("/") ? "/" : "") + trail;
    });
  }

  /** Markdown links relative to the old document → relative to the new one. */
  links(text: string, oldDoc: string, newDoc: string): string {
    const rel = (to: string) => posix.relative(posix.dirname(newDoc), to) || ".";
    return text.replace(LINK, (whole, open: string, target: string, close: string) => {
      if (/^[a-z]+:|^#|^\//.test(target)) return whole;
      const hash = target.indexOf("#");
      const path = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? "" : target.slice(hash);
      const oldAbs = posix.normalize(posix.join(posix.dirname(oldDoc), path)).replace(/\/$/, "");
      if (oldAbs.startsWith("..")) return `${open}${rel(oldAbs)}${anchor}${close}`; // outside specs/: same target, new depth
      const [to, known] = this.f.mapPath(oldAbs);
      if (!known) {
        this.#count("link unknown");
        return whole;
      }
      if (to === null) {
        this.#count("link → permalink");
        return `${open}${this.f.PERMALINK}${oldAbs}${anchor}${close}`;
      }
      let r = rel(to);
      if (path.endsWith("/") && !r.endsWith("/")) r += "/";
      this.#count(r !== path ? "link rewritten" : "link same");
      return `${open}${r}${anchor}${close}`;
    });
  }

  doc(text: string, oldDoc: string, newDoc: string, docVersion: string): string {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(LINK)) {
      out += this.bare(text.slice(last, m.index), docVersion) + this.links(m[0], oldDoc, newDoc);
      last = m.index + m[0].length;
    }
    return out + this.bare(text.slice(last), docVersion);
  }
}

function migrate(data: string, sha: string, mapOut: string): void {
  const f = planFlatten(data, sha);
  const rw = new Rewriter(f);
  const stage = join(f.SPECS, ".flat");
  rmSync(stage, { recursive: true, force: true });
  let fields = 0;
  for (const old of sorted(f.fileMap.keys())) {
    const to = f.fileMap.get(old);
    if (!to) continue;
    const src = join(f.SPECS, old);
    const dst = join(stage, to);
    mkdirSync(posix.dirname(dst), { recursive: true });
    const version = old.split("/")[0]!;
    if (old.endsWith(".md")) {
      let text = rw.doc(readFileSync(src, "utf8"), old, to, version);
      const fv = f.readmeFields.get(to);
      if (fv) {
        text = addFields(text, fv[0], fv[1]);
        fields++;
      }
      writeFileSync(dst, text);
    } else {
      copyFileSync(src, dst);
      if (dst.endsWith(".bp") || dst.endsWith(".txt")) {
        const t = readFileSync(dst, "utf8");
        const n = rw.bare(t, version);
        if (n !== t) writeFileSync(dst, n);
      }
    }
  }
  // The milestone's README names the milestone.
  const mr = join(stage, "milestone/README.md");
  writeFileSync(mr, addFields(readFileSync(mr, "utf8"), f.current));
  // The decision files at specs/'s root and the conversations: bare paths written from the current milestone.
  const others = readdirSync(f.SPECS).filter((n) => n.endsWith(".md")).map((n) => join(f.SPECS, n));
  const chat = join(data, "conversation-chat");
  if (existsSync(chat)) for (const p of walkFiles(chat)) if (p.endsWith(".md")) others.push(p);
  let changed = 0;
  for (const p of others) {
    const t = readFileSync(p, "utf8");
    const rel = posix.relative(f.SPECS, p);
    const n = rw.doc(t, rel, rel, f.current);
    if (n !== t) {
      writeFileSync(p, n);
      changed++;
    }
  }
  for (const v of f.versions) rmSync(join(f.SPECS, v), { recursive: true });
  for (const e of readdirSync(stage)) renameSync(join(stage, e), join(f.SPECS, e));
  rmSync(stage, { recursive: true });

  const moved: Record<string, string> = {};
  for (const old of sorted(f.fileMap.keys())) {
    if (!old.endsWith(".md")) continue;
    const to = f.fileMap.get(old);
    moved[old.slice(0, -3)] = to ? to.slice(0, -3) : f.PERMALINK + old;
  }
  writeFileSync(join(data, "moved.json"), `${JSON.stringify(moved, null, 1)}\n`);
  const obj = (m: Map<string, string | null>) => Object.fromEntries(sorted(m.keys()).map((k) => [k, m.get(k)]));
  writeFileSync(mapOut, JSON.stringify({ current: f.current, dirs: obj(f.dirMap), files: obj(f.fileMap), sha }, null, 1));

  for (const k of sorted(rw.stats.keys())) console.log(`${String(rw.stats.get(k)).padStart(6)} ${k}`);
  console.log(`${String(fields).padStart(6)} fields added`);
  console.log(`${String(changed).padStart(6)} root/chat files changed`);
  const kept = [...f.fileMap.values()].filter(Boolean).length;
  console.log(`${String(kept).padStart(6)} files kept, ${f.fileMap.size - kept} dropped`);
}

/** Another repository's files: bare spec paths (`specs/1.0.12-beta/machine-1/…`) rewritten in place. */
function rewrite(dataBefore: string, files: string[]): void {
  const f = planFlatten(dataBefore, "HEAD");
  const rw = new Rewriter(f);
  let changed = 0;
  for (const p of files) {
    const t = readFileSync(p, "utf8");
    const n = rw.bare(t, f.current);
    if (n !== t) {
      writeFileSync(p, n);
      changed++;
      console.log(p);
    }
  }
  console.error(`${changed} file(s) changed; ${rw.stats.get("bare rewritten") ?? 0} path(s) rewritten, ${rw.stats.get("bare kept") ?? 0} kept`);
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "migrate" && args.length === 3) migrate(args[0]!, args[1]!, args[2]!);
  else if (cmd === "rewrite" && args.length >= 2) rewrite(args[0]!, args.slice(1));
  else {
    console.error("usage: flatten.ts migrate <data> <sha> <map.json> | rewrite <data before> <file>…");
    process.exit(2);
  }
}
