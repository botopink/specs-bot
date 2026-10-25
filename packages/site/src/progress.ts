// A front's progress: what is done, what is open, what waits on a question. Nothing in the specs states it in one
// place, so it is gathered — and the pages say where each item comes from:
//
// - the front's README: each step heading (`### 150 s1 — …`, `### B-162 — …`, `### 105 Conformance — …`) with the
//   `- [x]` / `- [ ]` boxes under it — all boxed is done, any box open is open;
// - the milestone's status.md: each top-level `- [x]` / `- [ ]` item, filed under a lane (`## L1` … `## L4` open,
//   `## L5` blocked on a decision, `## Done` landed) and named for a front by its leading number
//   (`150 s25 — …`), else by its `###` heading's numbers (`### 151 json · 152 yaml`), else by the `NNN sN` /
//   `NNN B-N` labels in its text;
// - the pending questions whose text names the front (`front 165`, `machine-1/150`, `150 s31`, `144 B-162`):
//   the front waits on them; a README step a question names is blocked.
//
// Built once per model and milestone (the site is rebuilt on every write).
import type { Doc, PendingEntry } from "@specs-bot/core";
import type { SiteData } from "./data.ts";

export type ItemState = "done" | "open" | "blocked";

export interface ProgressItem {
  state: ItemState;
  /** "150 s1", "B-162", "L2 · 150 s25", "810-d". */
  label: string;
  /** What the item says, one line. */
  text: string;
  source: "readme" | "status" | "pending";
  href: string;
  boxes?: { done: number; total: number };
  /** status.md's lane: "L1" … "L5", "Done". */
  lane?: string;
}

export interface FrontProgress {
  num: number;
  version: string;
  /** The front's README steps (empty when its README has none). */
  steps: ProgressItem[];
  /** status.md's items for the front. */
  status: ProgressItem[];
  /** Open questions that name the front. */
  waiting: ProgressItem[];
  /** In-force decision rows whose Binds name the front. */
  binds: number[];
  /** Where the headline counts come from: the README's steps when it has any, else status.md. */
  basis: "readme" | "status" | "none";
  counts: { done: number; open: number; blocked: number };
}

const STEP_HEAD = /^(?:(\d{1,3})\s+)?(s\d+[a-z]?|B-\d+[a-z0-9]*(?:-[a-z0-9]+)*|Conformance)\b/;
const BOX = /^[-*] \[([ xX])\]\s+(.*)$/;

export function buildProgress(data: SiteData, version: string): Map<number, FrontProgress> {
  const docs = data.tree.docs.filter((d) => d.version === version);
  const nums = new Set<number>();
  for (const d of docs) if (d.front) nums.add(d.front.num);
  const out = new Map<number, FrontProgress>();
  for (const n of nums) {
    out.set(n, { num: n, version, steps: [], status: [], waiting: [], binds: [], basis: "none", counts: { done: 0, open: 0, blocked: 0 } });
  }

  // The pending questions that name each front, and the step labels they name ("150 s31" → blocked).
  const blockedLabels = new Set<string>();
  for (const e of data.entries) {
    const text = entryText(e);
    for (const n of nums) {
      if (!namesFront(text, n)) continue;
      out.get(n)!.waiting.push({
        state: "blocked",
        label: e.id,
        text: e.title,
        source: "pending",
        href: `/pending/${encodeURIComponent(e.id)}`,
      });
    }
    for (const m of text.matchAll(/\b(\d{1,3}) (s\d+[a-z]?|B-\d+[a-z0-9]*)\b/g)) blockedLabels.add(`${Number(m[1])} ${m[2]}`);
  }

  // The README steps of each front folder (144 has three folders: their steps add up).
  for (const d of docs) {
    if (!d.front || d.group || !d.ref.endsWith(`/${d.front.dir}/README`)) continue;
    out.get(d.front.num)!.steps.push(...readmeSteps(d, d.front.num, blockedLabels));
  }

  // status.md's items.
  const status = data.docByRef.get(`${version}/status`);
  if (status) {
    for (const item of statusItems(status, nums)) out.get(item.front)!.status.push(item.item);
  }

  // In-force rows that bind each front.
  for (const r of data.steps.rows) {
    if (r.status !== "in-force") continue;
    for (const n of nums) if (bindsFront(r.binds, n)) out.get(n)!.binds.push(r.num);
  }

  for (const p of out.values()) {
    const basis = p.steps.length ? p.steps : p.status;
    p.basis = p.steps.length ? "readme" : p.status.length ? "status" : "none";
    for (const i of basis) p.counts[i.state]++;
    p.binds.sort((a, b) => b - a);
  }
  return out;
}

function entryText(e: PendingEntry): string {
  return [e.section, e.title, ...e.fields.map((f) => f.text)].join("\n");
}

/** Whether a text names front n: "front 165", "machine-1/150", "`1-botopink-lang/144`", "150 s31", "144 B-162". */
export function namesFront(text: string, n: number): boolean {
  return new RegExp(`\\b[Ff]ront ${n}\\b|[a-z0-9-]+/${n}\\b|(?<![\\d.-])${n} (s\\d+|B-\\d+)\\b`).test(text);
}

function bindsFront(binds: string, n: number): boolean {
  return new RegExp(`/${n}\\b|\\b[Ff]ront ${n}\\b|(?<![\\d./-])${n} (s\\d+|B-\\d+)\\b`).test(binds);
}

function readmeSteps(d: Doc, front: number, blockedLabels: Set<string>): ProgressItem[] {
  const items: ProgressItem[] = [];
  let taken = -1; // a step's own range: a matching heading inside it is part of it
  for (const s of d.sections) {
    if (s.level < 2 || s.start < taken) continue;
    const m = s.heading.match(STEP_HEAD);
    if (!m || (m[1] && Number(m[1]) !== front)) continue;
    taken = s.end;
    let done = 0;
    let total = 0;
    for (let i = s.start + 1; i < s.end; i++) {
      const b = d.lines[i]!.match(/^\s*[-*] \[([ xX])\]/);
      if (!b) continue;
      total++;
      if (b[1] !== " ") done++;
    }
    const label = `${front} ${m[2]}`;
    const rest = s.heading.slice(m[0].length).replace(/^\s*[—–:·-]\s*/, "");
    const state: ItemState = blockedLabels.has(label) && done < total ? "blocked" : total > 0 && done === total ? "done" : total === 0 && /\b(done|landed)\b/i.test(s.heading) ? "done" : "open";
    items.push({ state, label, text: rest || s.heading, source: "readme", href: `/docs/${d.ref}#${s.anchor}`, ...(total ? { boxes: { done, total } } : {}) });
  }
  return items;
}

/** The lane a `##` heading of status.md opens: "L1" … "L5", "Done"; undefined for any other heading. */
function laneOf(heading: string): string | undefined {
  const m = heading.match(/^(L\d+|Done)\b/);
  return m?.[1];
}

function statusItems(doc: Doc, nums: Set<number>): { front: number; item: ProgressItem }[] {
  const out: { front: number; item: ProgressItem }[] = [];
  const headingAt = new Map(doc.sections.map((s) => [s.start, s]));
  let lane: string | undefined;
  let anchor = doc.sections[0]?.anchor ?? "";
  let headNums: number[] = [];
  doc.lines.forEach((line, i) => {
    const s = headingAt.get(i);
    if (s) {
      anchor = s.anchor;
      if (s.level === 2) {
        lane = laneOf(s.heading);
        headNums = [];
      } else if (s.level === 3) {
        headNums = s.heading
          .split(" · ")
          .map((part) => part.match(/^(\d{1,3})\b/)?.[1])
          .filter((x): x is string => x !== undefined)
          .map(Number);
      }
      return;
    }
    const b = line.match(BOX);
    if (!b || !lane) return;
    const text = b[2]!;
    const lead = text.match(/^\**(\d{1,3})\b/);
    let fronts = lead ? [Number(lead[1])] : headNums;
    if (!fronts.length) fronts = [...new Set([...text.matchAll(/(?<![\d./-])(\d{1,3}) (?:s\d+|B-\d+)\b/g)].map((m) => Number(m[1])))];
    const state: ItemState = lane === "Done" || b[1] !== " " ? "done" : lane === "L5" ? "blocked" : "open";
    const [head, ...more] = text.split(" — ");
    const label = head!.length <= 60 ? head! : `${head!.slice(0, 57)}…`;
    for (const f of fronts) {
      if (!nums.has(f)) continue;
      out.push({ front: f, item: { state, label, text: more.join(" — ") || (head!.length > 60 ? head! : ""), source: "status", href: `/docs/${doc.ref}#${anchor}`, lane } });
    }
  });
  return out;
}

/** The share done, as a whole percentage (0 with nothing counted). */
export function percent(c: FrontProgress["counts"]): number {
  const total = c.done + c.open + c.blocked;
  return total ? Math.round((100 * c.done) / total) : 0;
}
