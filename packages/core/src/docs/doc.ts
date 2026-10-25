// A milestone document: any .md under specs/<version>/. Its metadata comes from the path alone (2 of 597 files
// have frontmatter): `<version>/[machine-N/]<NNN-front>/[<NNN-group>/]…/<name>.md`.

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
  version: string;
  machine?: string;
  front?: { num: number; slug: string };
  group?: { num: number; slug: string };
  /** The file name without `.md`: "README", "status", "track", "context", … */
  name: string;
}

export interface Doc extends DocMeta {
  title: string;
  lines: string[];
  sections: Section[];
  links: string[];
}

const NUMBERED = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;
const VERSION = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

export function docMeta(path: string): DocMeta {
  if (!path.endsWith(".md")) throw new Error(`not a markdown path: ${path}`);
  const ref = path.slice(0, -3);
  const parts = ref.split("/");
  const version = parts[0]!;
  if (!VERSION.test(version) || parts.length < 2) throw new Error(`not under a milestone: ${path}`);
  const name = parts.at(-1)!;
  const dirs = parts.slice(1, -1);
  const meta: DocMeta = { ref, version, name };
  if (dirs[0]?.startsWith("machine-")) meta.machine = dirs.shift()!;
  const numbered = dirs.map((d) => d.match(NUMBERED)).filter((m) => m !== null);
  if (numbered[0]) meta.front = { num: Number(numbered[0][1]), slug: numbered[0][2]! };
  if (numbered[1]) meta.group = { num: Number(numbered[1][1]), slug: numbered[1][2]! };
  return meta;
}

export function parseDoc(path: string, text: string): Doc {
  const lines = text.split("\n");
  const sections = sectionsOf(lines);
  const h1 = sections.find((s) => s.level === 1);
  return {
    ...docMeta(path),
    title: h1?.heading ?? docMeta(path).name,
    lines,
    sections,
    links: linksOf(text),
  };
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

function linksOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) out.add(m[1]!);
  return [...out];
}

export function sectionText(doc: Doc, anchor: string): string | undefined {
  const s = doc.sections.find((x) => x.anchor === anchor);
  return s && doc.lines.slice(s.start, s.end).join("\n");
}

export function serializeDoc(doc: Doc): string {
  return doc.lines.join("\n");
}
