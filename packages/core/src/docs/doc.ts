// A spec document: any .md under specs/ except the decision files at its root. The tree is flat
// (`<NNN-front>/[<NNN-group>/]…/<name>.md`, the milestone's own documents in `milestone/`); a front's milestone
// and machine are keys of the YAML block at its top (`milestone: 1.0.12-beta`, `owner: machine-1`; meta.ts).

import { type Meta, splitMeta } from "./meta.ts";

export interface Section {
  level: number;
  heading: string;
  /** GitHub's anchor for the heading, unique within the document. */
  anchor: string;
  /** Line of the heading. */
  start: number;
  /** One past the section's last line: the next heading of the same or a higher level, or the end. */
  end: number;
}

export interface DocMeta {
  /** The path without `.md`, relative to specs/: the id the api speaks, never a file path. */
  ref: string;
  /** The milestone it belongs to: the nearest `**Milestone:**` field from its folder up (load.ts). */
  version: string;
  owner?: string;
  /** The first numbered directory, its name as written in `dir` ("150-rakun"). */
  front?: { num: number; slug: string; dir: string };
  group?: { num: number; slug: string; dir: string };
  /** The file name without `.md`: "README", "status", "track", "context", … */
  name: string;
}

export interface Doc extends DocMeta {
  title: string;
  lines: string[];
  sections: Section[];
  links: string[];
  /** The YAML block at its top (meta.ts): every key, and the two the tree places it by. */
  meta: Meta;
  fields: { milestone?: string; owner?: string };
  /** Why the block could not be read, when it could not. */
  metaError?: string;
}

const NUMBERED = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;

/** Where a path sits in the tree; `version` and `machine` are filled by the loader from the fields. */
export function docMeta(path: string): DocMeta {
  if (!path.endsWith(".md")) throw new Error(`not a markdown path: ${path}`);
  const ref = path.slice(0, -3);
  const parts = ref.split("/");
  if (parts.length < 2) throw new Error(`not in a folder under specs/: ${path}`);
  const name = parts.at(-1)!;
  const meta: DocMeta = { ref, version: "", name };
  const numbered = parts.slice(0, -1).map((d) => d.match(NUMBERED)).filter((m) => m !== null);
  if (numbered[0] && parts[0] === numbered[0][0]) {
    meta.front = { num: Number(numbered[0][1]), slug: numbered[0][2]!, dir: numbered[0][0] };
    if (numbered[1]) meta.group = { num: Number(numbered[1][1]), slug: numbered[1][2]!, dir: numbered[1][0] };
  }
  return meta;
}

export function parseDoc(path: string, text: string): Doc {
  const lines = text.split("\n");
  const sections = sectionsOf(lines);
  const h1 = sections.find((s) => s.level === 1);
  // A sample under examples/ (a post a library renders) keeps its own block; it is not the spec's metadata.
  const { meta, error } = path.includes("/examples/") ? { meta: {} as Meta, error: undefined } : splitMeta(lines);
  const fields: Doc["fields"] = {};
  if (meta.milestone) fields.milestone = meta.milestone;
  if (meta.owner) fields.owner = meta.owner;
  const where = docMeta(path);
  return { ...where, title: h1?.heading ?? where.name, lines, sections, links: linksOf(lines), meta, fields, ...(error ? { metaError: error } : {}) };
}

const HEADING = /^(#{1,6}) +(.+?) *#* *$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function sectionsOf(lines: string[]): Section[] {
  const found: Omit<Section, "end">[] = [];
  const used = new Map<string, number>();
  let fence: string | undefined;
  lines.forEach((line, i) => {
    const f = line.match(FENCE);
    if (f) {
      if (!fence) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (line.trimStart().startsWith(fence)) fence = undefined;
      return;
    }
    if (fence) return;
    const m = line.match(HEADING);
    if (!m) return;
    const heading = m[2]!;
    found.push({ level: m[1]!.length, heading, anchor: uniqueAnchor(anchorOf(heading), used), start: i });
  });
  return found.map((s, k) => {
    const next = found.slice(k + 1).find((n) => n.level <= s.level);
    return { ...s, end: next ? next.start : lines.length };
  });
}

/** GitHub's heading anchor: lower case, punctuation dropped (letters, digits, `-`, `_` and spaces kept), spaces → `-`. */
export function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

function uniqueAnchor(base: string, used: Map<string, number>): string {
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** Link targets outside fenced blocks and inline code: `xs[i](n)` in code is no link. */
function linksOf(lines: string[]): string[] {
  const out = new Set<string>();
  let fence: string | undefined;
  for (const line of lines) {
    const f = line.match(FENCE);
    if (f) {
      if (!fence) fence = f[1]![0]!.repeat(f[1]!.length);
      else if (line.trimStart().startsWith(fence)) fence = undefined;
      continue;
    }
    if (fence) continue;
    const prose = line.replace(/(`+)[^`]*?\1/g, "");
    for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) out.add(m[1]!);
  }
  return [...out];
}

export function sectionText(doc: Doc, anchor: string): string | undefined {
  const s = doc.sections.find((x) => x.anchor === anchor);
  return s && doc.lines.slice(s.start, s.end).join("\n");
}

export function serializeDoc(doc: Doc): string {
  return doc.lines.join("\n");
}
