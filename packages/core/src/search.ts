// Full-text search over everything the bot reads, one unit per quotable piece: a step, a pending question,
// a subject, a retired row, one document section (its own text, not its subsections') or a message.
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

export function units(store: Store): Unit[] {
  const out: Unit[] = [];
  for (const r of store.steps.rows) {
    out.push({ id: `step:${r.num}`, kind: "step", key: String(r.num), title: `${r.num} · ${r.id}`, text: `${r.rule}\n${r.binds}` });
  }
  for (const e of pendingEntries(store.pending)) {
    const text = e.fields.map((f) => `${f.name}. ${f.text}`).join("\n");
    out.push({ id: `pending:${e.id}`, kind: "pending", key: e.id, title: `${e.id} · ${e.title}`, text });
  }
  for (const s of store.taken.subjects) {
    out.push({ id: `subject:${s.slug}`, kind: "subject", key: s.slug, title: `${s.slug} — ${s.summary}`, text: [s.lead, ...s.paragraphs].join("\n") });
  }
  store.retired.rows.forEach((r, i) => {
    out.push({ id: `retired:${i}`, kind: "retired", key: r.retired, title: `${r.retired} → ${r.replacedBy}`, text: `${r.area}\n${r.note}` });
  });
  for (const d of store.tree.docs) {
    const frozen = d.version !== store.tree.current;
    const scope = {
      version: d.version,
      frozen,
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
    out.push({ id: `message:${m.id}`, kind: "message", key: m.id, title: `${m.from} → ${m.to} · ${m.subject}`, text: m.body });
  }
  return out;
}

const LITERAL_BOOST = 3;

export function buildIndex(store: Store): SearchIndex {
  const all = units(store);
  const byId = new Map(all.map((u) => [u.id, u]));
  const index = new MiniSearch<Unit>({
    fields: ["key", "title", "text"],
    // Every run of letters and digits is a term: MiniSearch's default keeps backticks and other symbols on a
    // word, so `` `for-await-one-source` `` would index "`for" and "source`".
    tokenize: (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    storeFields: [],
    searchOptions: { boost: { key: 4, title: 2 }, prefix: true, fuzzy: 0.15, combineWith: "AND" },
  });
  index.addAll(all);

  return {
    size: all.length,
    search(query, opts = {}) {
      const limit = opts.limit ?? 10;
      const results = index.search(query, {
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
        .sort((a, b) => b.score - a.score);
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
    },
  };
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
