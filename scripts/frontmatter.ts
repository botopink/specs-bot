#!/usr/bin/env bun
// Move every spec document's metadata into a YAML block at its top (the maintainer, 2026-10-26):
//
//   bun scripts/frontmatter.ts <specs-data checkout>
//
// The `**Key:** value` lines right under a document's title (a value may run on over the next lines) become
// keys of the block (meta.ts: "Depends on" → depends-on, "Machine" → owner); a block already there keeps its
// keys. Every document gets `milestone` and, when it has one, `owner` explicitly — the ones it inherited from
// the nearest README above it until now. examples/ holds sample content (a post a library renders, with its own
// block), not spec documents: it is left alone. The text below the fields is left as it was. Each rewritten file is
// read back: its block must give the same map and its body the same lines, or nothing is written.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { metaKey, metaLines, splitMeta, type Meta } from "../packages/core/src/docs/meta.ts";

const FIELD = /^\*\*([^*]+?):\*\*(?: (.*))?$/;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith(".md")) yield p;
  }
}

interface Parsed {
  rel: string;
  lines: string[];
  /** The block already at the top. */
  front: Meta;
  frontEnd: number;
  fields: [string, string][];
  /** The field lines to drop: [from, to) — the blank line after them included. */
  drop?: [number, number];
}

function parse(rel: string, text: string): Parsed {
  const lines = text.split("\n");
  const { meta: front, end: frontEnd, error } = splitMeta(lines);
  if (error) throw new Error(`${rel}: ${error}`);
  const out: Parsed = { rel, lines, front, frontEnd, fields: [] };
  const title = lines.findIndex((l, i) => i >= frontEnd && l.startsWith("# "));
  if (title < 0) return out;
  let j = title + 1;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  if (!FIELD.test(lines[j] ?? "")) return out;
  const from = j;
  for (; j < lines.length && lines[j]!.trim() !== ""; j++) {
    const m = lines[j]!.match(FIELD);
    if (m) out.fields.push([m[1]!, m[2] ?? ""]);
    else out.fields.at(-1)![1] += `\n${lines[j]}`;
  }
  out.drop = [from, j < lines.length ? j + 1 : j];
  return out;
}

const data = process.argv[2];
if (!data) {
  console.error("usage: frontmatter.ts <specs-data checkout>");
  process.exit(2);
}
const specs = join(data, "specs");
const docs: Parsed[] = [];
for (const file of walk(specs)) {
  const rel = relative(specs, file);
  if (rel.includes("/") && !rel.includes("/examples/")) docs.push(parse(rel, readFileSync(file, "utf8")));
}

// Milestone and owner as the tree placed them: the document's own fields, else the nearest README's above it.
const own = (d: Parsed, label: string) => d.fields.find(([k]) => k === label)?.[1];
const readmes = new Map(docs.filter((d) => d.rel.endsWith("/README.md")).map((d) => [posix.dirname(d.rel), d]));
const current = own(readmes.get("milestone")!, "Milestone");
if (!current) throw new Error("milestone/README.md names no milestone");
const placed = (d: Parsed, label: string) => {
  const mine = own(d, label);
  if (mine) return mine;
  const parts = posix.dirname(d.rel).split("/");
  for (let i = parts.length; i > 0; i--) {
    const v = readmes.get(parts.slice(0, i).join("/"));
    const f = v && own(v, label);
    if (f) return f;
  }
  return undefined;
};

const keyCount = new Map<string, number>();
let written = 0;
for (const d of docs) {
  const milestone = placed(d, "Milestone") ?? current;
  const machine = placed(d, "Machine") ?? (/^milestone\/(machine-\d+)\.md$/.exec(d.rel)?.[1]);
  const meta: Meta = { milestone, ...(machine ? { owner: machine } : {}) };
  for (const [k, v] of Object.entries(d.front)) if (!(k in meta)) meta[k] = v;
  for (const [label, value] of d.fields) {
    if (label === "Milestone" || label === "Machine") continue;
    let k = metaKey(label);
    for (let n = 2; k in meta; n++) k = `${metaKey(label)}-${n}`; // a field written twice keeps both
    meta[k] = value;
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }
  const body = d.drop ? [...d.lines.slice(d.frontEnd, d.drop[0]), ...d.lines.slice(d.drop[1])] : d.lines.slice(d.frontEnd);
  const next = [...metaLines(meta), ...body];

  // Read it back before writing.
  const back = splitMeta(next);
  if (back.error || JSON.stringify(back.meta) !== JSON.stringify(meta)) {
    throw new Error(`${d.rel}: the block does not read back as written (${back.error ?? JSON.stringify(back.meta).slice(0, 200)})`);
  }
  if (next.slice(back.end).join("\n") !== body.join("\n")) throw new Error(`${d.rel}: the body changed`);
  writeFileSync(join(specs, d.rel), next.join("\n"));
  written++;
}
console.log(`${written} documents, current milestone ${current}`);
console.log([...keyCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(4)} ${k}`).join("\n"));
