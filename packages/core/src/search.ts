// Full-text search over everything the bot reads, one unit per quotable piece: a step, a pending question,
// a subject, a retired row, one document section (its own text, not its subsections') or a message.
// After a write the index is updated in place: only the units read from the files the write changed are replaced.
import MiniSearch from "minisearch";
import { pendingEntries } from "./decisions/pending.ts";
import type { Store } from "./store.ts";

export type Kind = "step" | "pending" | "subject" | "retired" | "section" | "message";

export interface Unit {
  /** Unique across kinds: "step:814", "pending:810-d", "section:<ref>#<anchor>", … */
  id: string;
  kind: Kind;
  /** What the api names it by: "814", "810-d", a subject slug, "<ref>#<anchor>", a message id. */
  key: string;
  title: string;
  text: string;
  version?: string;
  machine?: string;
  front?: number;
  frozen?: boolean;
  /** The file it is read from, relative to the data repository: "specs/retired.md", "conversation-chat/all/….md". */
  file: string;
}

export interface Hit {
  kind: Kind;
  key: string;
  title: string;
  snippet: string;
  score: number;
  version?: string;
  machine?: string;
  front?: number;
}

export interface SearchOptions {
  kinds?: Kind[];
  version?: string;
  machine?: string;
  front?: number;
  /** Sections of closed milestones are left out unless asked for. */
  frozen?: boolean;
  limit?: number;
}

export interface SearchIndex {
  search(query: string, opts?: SearchOptions): Hit[];
  size: number;
}

// The decision files, as store.ts reads them.
const STEPS_FILE = "specs/decisions-taken-steps.md";
const PENDING_FILE = "specs/decisions-pending.md";
const TAKEN_FILE = "specs/decisions-taken.md";
const RETIRED_FILE = "specs/retired.md";

export function units(store: Store): Unit[] {
  const out: Unit[] = [];
  for (const r of store.steps.rows) {
    out.push({ id: `step:${r.num}`, kind: "step", key: String(r.num), title: `${r.num} · ${r.id}`, text: `${r.rule}\n${r.binds}`, file: STEPS_FILE });
  }
  for (const e of pendingEntries(store.pending)) {
    const text = e.fields.map((f) => `${f.name}. ${f.text}`).join("\n");
    out.push({ id: `pending:${e.id}`, kind: "pending", key: e.id, title: `${e.id} · ${e.title}`, text, file: PENDING_FILE });
  }
  for (const s of store.taken.subjects) {
    out.push({ id: `subject:${s.slug}`, kind: "subject", key: s.slug, title: `${s.slug} — ${s.summary}`, text: [s.lead, ...s.paragraphs].join("\n"), file: TAKEN_FILE });
  }
  store.retired.rows.forEach((r, i) => {
    out.push({ id: `retired:${i}`, kind: "retired", key: r.retired, title: `${r.retired} → ${r.replacedBy}`, text: `${r.area}\n${r.note}`, file: RETIRED_FILE });
  });
  for (const d of store.tree.docs) {
    const frozen = d.version !== store.tree.current;
    const scope = {
      version: d.version,
      frozen,
      file: `specs/${d.ref}.md`,
      ...(d.machine ? { machine: d.machine } : {}),
      ...(d.front ? { front: d.front.num } : {}),
    };
    d.sections.forEach((s, k) => {
      // The section's own text: up to the next heading of any level, so a subsection is its own unit.
      const own = d.sections[k + 1]?.start ?? d.lines.length;
      const key = `${d.ref}#${s.anchor}`;
      const title = s.level === 1 ? s.heading : `${d.title} › ${s.heading}`;
      out.push({ id: `section:${key}`, kind: "section", key, title, text: d.lines.slice(s.start + 1, Math.min(own, s.end)).join("\n"), ...scope });
    });
  }
  for (const m of store.chat) {
    out.push({ id: `message:${m.id}`, kind: "message", key: m.id, title: `${m.from} → ${m.to} · ${m.subject}`, text: m.body, file: `conversation-chat/${m.ref}.md` });
  }
  return out;
}

const LITERAL_BOOST = 3;

/** What an index answers from. An update changes it in place and hands it on to the index it returns. */
interface Core {
  mini: MiniSearch<Unit>;
  byId: Map<string, Unit>;
  /** A unit's place in units(): units of equal score come in that order, whatever order they were indexed in. */
  order: Map<string, number>;
  /** The index the core is now; an older one is spent. */
  owner?: SearchIndex;
}

const cores = new WeakMap<SearchIndex, Core>();

export function buildIndex(store: Store): SearchIndex {
  const all = units(store);
  const mini = new MiniSearch<Unit>({
    fields: ["key", "title", "text"],
    // Every run of letters and digits is a term: MiniSearch's default keeps backticks and other symbols on a
    // word, so `` `for-await-one-source` `` would index "`for" and "source`".
    tokenize: (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    storeFields: [],
    searchOptions: { boost: { key: 4, title: 2 }, prefix: true, fuzzy: 0.15, combineWith: "AND" },
  });
  mini.addAll(all);
  return indexOver({ mini, byId: new Map(), order: new Map() }, all);
}

/**
 * The index over `store`, the data `index` was built over with only the files at `paths` (relative to the data
 * repository: `specs/…`, `conversation-chat/…`) changed. The units read from those files are replaced, every other
 * one is kept as it was indexed; it answers exactly as `buildIndex(store)` would. `index` is spent: from then on it
 * answers over the new data. A spent index is not updated again: the index is built anew.
 */
export function updateIndex(index: SearchIndex, store: Store, paths: string[]): SearchIndex {
  const core = cores.get(index);
  if (!core || core.owner !== index) return buildIndex(store);
  const touched = new Set(paths);
  const all = units(store);
  const next = new Map(all.map((u) => [u.id, u]));
  for (const old of core.byId.values()) {
    if (touched.has(old.file) && !next.has(old.id)) core.mini.remove(old);
  }
  for (const u of all) {
    const old = core.byId.get(u.id);
    if (!old) core.mini.add(u);
    else if ((touched.has(u.file) || touched.has(old.file)) && !sameTerms(old, u)) {
      // remove() takes the unit as it was indexed, so its terms come out exactly.
      core.mini.remove(old);
      core.mini.add(u);
    }
  }
  settleAverages(core.mini, all);
  // A unit whose terms did not change keeps its postings; what is not indexed (a section's milestone, machine,
  // frozen, which a README or the current milestone moves) is read from byId, which indexOver takes from the new data.
  return indexOver(core, all);
}

const sameTerms = (a: Unit, b: Unit) => a.key === b.key && a.title === b.title && a.text === b.text;

/**
 * MiniSearch keeps each field's average length as a running mean, so its last bits depend on the order units
 * came and went. Recomputed the way addAll() over units() computes it, the scores are a fresh build's to the bit.
 */
function settleAverages(mini: MiniSearch<Unit>, all: Unit[]): void {
  const m = mini as unknown as { _avgFieldLength: number[]; _fieldLength: Map<number, number[]>; _idToShortId: Map<string, number> };
  const avg: number[] = [];
  all.forEach((u, count) => {
    m._fieldLength.get(m._idToShortId.get(u.id)!)!.forEach((length, f) => {
      avg[f] = ((avg[f] || 0) * count + length) / (count + 1);
    });
  });
  m._avgFieldLength = avg;
}

function indexOver(core: Core, all: Unit[]): SearchIndex {
  core.byId = new Map(all.map((u) => [u.id, u]));
  core.order = new Map(all.map((u, i) => [u.id, i]));
  const index: SearchIndex = { size: all.length, search: (query, opts) => search(core, query, opts) };
  core.owner = index;
  cores.set(index, core);
  return index;
}

function search(core: Core, query: string, opts: SearchOptions = {}): Hit[] {
  const { mini, byId, order } = core;
  const limit = opts.limit ?? 10;
  const results = mini.search(query, {
    filter: (r) => {
      const u = byId.get(r.id as string)!;
      if (opts.kinds && !opts.kinds.includes(u.kind)) return false;
      if (u.kind === "section") {
        if (u.frozen && !opts.frozen && !opts.version) return false;
        if (opts.version && u.version !== opts.version) return false;
        if (opts.machine && u.machine !== opts.machine) return false;
        if (opts.front !== undefined && u.front !== opts.front) return false;
      } else if (opts.version || opts.machine || opts.front !== undefined) {
        return false;
      }
      return true;
    },
  });
  // A unit holding the query word for word (a refusal code, a quoted phrase) outranks fuzzy and prefix matches.
  const literal = query.trim().toLowerCase();
  const ranked = results
    .map((r) => {
      const u = byId.get(r.id as string)!;
      const exact = literal.length > 2 && `${u.key}\n${u.title}\n${u.text}`.toLowerCase().includes(literal);
      return { r, u, score: exact ? r.score * LITERAL_BOOST : r.score };
    })
    .sort((a, b) => b.score - a.score || order.get(a.u.id)! - order.get(b.u.id)!);
  return ranked.slice(0, limit).map(({ r, u, score }) => {
    return {
      kind: u.kind,
      key: u.key,
      title: u.title,
      snippet: snippet(u.text, r.terms),
      score: Math.round(score * 100) / 100,
      ...(u.version ? { version: u.version } : {}),
      ...(u.machine ? { machine: u.machine } : {}),
      ...(u.front !== undefined ? { front: u.front } : {}),
    };
  });
}

/** About 160 characters around the first matched term, on one line. */
export function snippet(text: string, terms: string[], width = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - Math.floor(width / 3));
  const cut = flat.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${cut}${start + width < flat.length ? "…" : ""}`;
}

/** What an index holds, by unit id instead of MiniSearch's own numbers: an updated index and a fresh one compare equal. */
export function indexContents(index: SearchIndex) {
  const core = cores.get(index)!;
  const json = core.mini.toJSON();
  const idOf = (short: string) => json.documentIds[short] as string;
  const byUnit = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [idOf(k), v] as const).sort(([a], [b]) => a.localeCompare(b)));
  return {
    units: [...core.byId.values()],
    documentCount: json.documentCount,
    averageFieldLength: json.averageFieldLength,
    fieldLength: byUnit(json.fieldLength),
    terms: Object.fromEntries(
      json.index
        .map(([term, fields]) => [term, Object.fromEntries(Object.entries(fields).map(([f, docs]) => [f, byUnit(docs)]))] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
