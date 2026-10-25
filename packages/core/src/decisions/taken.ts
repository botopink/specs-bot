// decisions-taken.md — the rules in force, one `## <slug> — <summary>` subject each: a bold lead sentence,
// paragraphs ("(1) …"), then `Steps: <n>, <n>, …` (the rows it consolidates) and `Binds: …`.

export interface Subject {
  slug: string;
  summary: string;
  /** The bold first sentence, without its `**`; empty when the subject opens with a plain paragraph. */
  lead: string;
  /** Paragraphs between the lead and `Steps:`, each the blank-line-separated block as written. */
  paragraphs: string[];
  steps: number[];
  binds: string;
  /** The subject's lines, heading first, up to the next `##`. */
  lines: string[];
  line: number;
}

export interface TakenDoc {
  lines: string[];
  head: string[];
  subjects: Subject[];
}

const HEADING = /^## ([a-z0-9-]+) — (.+)$/;

export function parseTaken(text: string): TakenDoc {
  const lines = text.split("\n");
  const head: string[] = [];
  const blocks: { line: number; lines: string[] }[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("## ")) blocks.push({ line: i, lines: [line] });
    else if (blocks.length > 0) blocks.at(-1)!.lines.push(line);
    else head.push(line);
  });
  return { lines, head, subjects: blocks.map((b) => parseSubject(b.lines, b.line)) };
}

function parseSubject(lines: string[], line: number): Subject {
  const m = lines[0]!.match(HEADING);
  if (!m) throw new Error(`line ${line + 1}: a subject heading is "## <slug> — <summary>": ${lines[0]}`);

  let lead = "";
  let steps: number[] = [];
  let binds = "";
  // `Steps:` and `Binds:` are read wherever they stand: some follow a paragraph with no blank line between.
  const body: string[] = [];
  for (const l of lines.slice(1)) {
    if (l.startsWith("Steps:")) steps = parseNumberList(l.slice("Steps:".length));
    else if (l.startsWith("Binds:")) binds = l.slice("Binds:".length).trim();
    else body.push(l);
  }
  const paragraphs: string[] = [];
  for (const block of paragraphsOf(body)) {
    if (!lead && paragraphs.length === 0 && /^\*\*.*\*\*$/.test(block)) lead = block.slice(2, -2);
    else if (block !== "---") paragraphs.push(block);
  }
  return { slug: m[1]!, summary: m[2]!, lead, paragraphs, steps, binds, lines, line };
}

function paragraphsOf(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const l of [...lines, ""]) {
    if (l.trim()) cur.push(l);
    else if (cur.length) {
      out.push(cur.join("\n"));
      cur = [];
    }
  }
  return out;
}

/** "107, 110, 140" → [107, 110, 140]; refuses anything else so a malformed list is never half-read. */
export function parseNumberList(raw: string): number[] {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !/^\d+$/.test(p));
  if (bad.length) throw new Error(`not a step number: ${bad.join(", ")}`);
  return parts.map(Number);
}

export function serializeTaken(doc: TakenDoc): string {
  return [...doc.head, ...doc.subjects.flatMap((s) => s.lines)].join("\n");
}
