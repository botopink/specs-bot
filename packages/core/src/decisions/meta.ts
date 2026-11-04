// A decisions-taken group's metadata: the YAML block at the top of `decisions-taken/<slug>.md`, before its H1.
//
//   ---
//   scope: >-
//     How `==` and `!=` are decided: structural by value on every target, …
//   terms:
//     - '`==`'
//   related:
//     - 'numbers-and-arithmetic'
//   binds:
//     - '01-checker'
//   retired:
//     - '`===`, `behavior Eq`, a user `equals`'
//   first-step: 210
//   last-step: 738
//   in-force: 10
//   superseded: 0
//   ---
//   # equality — `==` is structural, user code never runs
//
// Hand-written keys (scope, terms, related, open) say what the group decides and where its edge is, so an agent
// picks a group without reading its body; they are trusted, only their shape is checked. Derived keys (binds,
// retired, first-step, last-step, in-force, superseded) are recomputed from the group's rows and retired.md
// (deriveGroupMeta): check.ts flags them when stale. Unlike docs/meta.ts's Meta (every value a string), lists stay
// lists and counts stay numbers here.
import { parseDocument } from "yaml";
import type { RetiredDoc } from "./retired.ts";
import type { StepRow } from "./steps.ts";

export const GROUP_META_HAND = ["scope", "terms", "related", "open"] as const;
export const GROUP_META_DERIVED = ["binds", "retired", "first-step", "last-step", "in-force", "superseded"] as const;

export interface GroupDerived {
  binds: string[];
  retired: string[];
  "first-step": number;
  "last-step": number;
  "in-force": number;
  superseded: number;
}

export interface GroupMeta extends GroupDerived {
  scope: string;
  terms: string[];
  related: string[];
  open?: string[];
}

/** A block's keys as written: whatever YAML gave, checked by groupMetaProblems. */
export type GroupMetaRaw = Partial<GroupMeta> & Record<string, unknown>;

export interface GroupMetaSplit {
  /** The block read as written (absent keys absent), when it is a readable mapping; undefined without a block. */
  meta?: GroupMetaRaw;
  /** Index of the first line after the block: the H1. 0 when the file has no block. */
  end: number;
  /** Why the block could not be read (no closing `---`, bad YAML, not a mapping). */
  error?: string;
}

/** The group's block, read with its types; a file without one is `{ end: 0 }`. */
export function splitGroupMeta(lines: string[]): GroupMetaSplit {
  if (lines[0] !== "---") return { end: 0 };
  const close = lines.indexOf("---", 1);
  if (close < 0) return { end: 0, error: "the metadata block has no closing ---" };
  const doc = parseDocument(lines.slice(1, close).join("\n"));
  if (doc.errors.length) return { end: close + 1, error: doc.errors[0]!.message.split("\n")[0]! };
  const raw = doc.toJS() as unknown;
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) return { end: close + 1, error: "the metadata block is not a mapping" };
  return { meta: (raw ?? {}) as GroupMetaRaw, end: close + 1 };
}

/** What is wrong with a block's keys and value types; empty when every key is known and well typed. */
export function groupMetaProblems(meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  const known = new Set<string>([...GROUP_META_HAND, ...GROUP_META_DERIVED]);
  for (const k of Object.keys(meta)) if (!known.has(k)) out.push(`unknown key ${k}`);
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
  if (typeof meta.scope !== "string" || !meta.scope.trim()) out.push("scope must be a non-empty string");
  for (const k of ["terms", "related", "binds", "retired"] as const) if (!strings(meta[k])) out.push(`${k} must be a list of strings`);
  if (meta.open !== undefined && !strings(meta.open)) out.push("open must be a list of strings");
  for (const k of ["first-step", "last-step", "in-force", "superseded"] as const) {
    if (!Number.isInteger(meta[k])) out.push(`${k} must be a whole number`);
  }
  return out;
}

/**
 * A Binds token kept in `binds`: one that names a front, repo, target or process (`04-js`, `01-compiler/139`,
 * `1-botopink-lang/144 B-32`, `machine-1/144`, `process`) — free prose in a Binds cell is no target.
 */
const BIND_TARGET = /^`?(\d{1,2}[-/][a-z0-9]|\d-[a-z]|machine-\d|process$|[a-z-]+\/\d)/i;

/** The derived keys, recomputed from a group's own rows and retired.md. */
export function deriveGroupMeta(rows: StepRow[], retired: RetiredDoc): GroupDerived {
  const nums = new Set(rows.map((r) => r.num));
  const inForce = rows.filter((r) => r.status === "in-force");
  const binds = new Set<string>();
  for (const r of inForce) {
    for (const b of r.binds.split(" · ")) if (b.trim() && BIND_TARGET.test(b.trim())) binds.add(b.trim());
  }
  const forms: string[] = [];
  for (const r of retired.rows) if (r.steps.some((n) => nums.has(n)) && !forms.includes(r.retired)) forms.push(r.retired);
  return {
    binds: [...binds].sort((a, b) => a.localeCompare(b)),
    retired: forms,
    "first-step": rows.length ? Math.min(...nums) : 0,
    "last-step": rows.length ? Math.max(...nums) : 0,
    "in-force": inForce.length,
    superseded: rows.length - inForce.length,
  };
}

/** The derived keys whose written value differs from the recomputed one. */
export function staleGroupMeta(meta: Record<string, unknown>, derived: GroupDerived): { key: string; have: unknown; want: unknown }[] {
  return GROUP_META_DERIVED.filter((k) => JSON.stringify(meta[k] ?? null) !== JSON.stringify(derived[k])).map((k) => ({
    key: k,
    have: meta[k],
    want: derived[k],
  }));
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

function wrap(text: string, width = 100): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (cur && `${cur} ${w}`.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

function list(key: string, items: string[]): string[] {
  return items.length ? [`${key}:`, ...items.map((i) => `  - ${quote(i)}`)] : [`${key}: []`];
}

/**
 * The block's lines: hand keys in their fixed order, then derived ones; `scope` folded at 100 columns, list items
 * single-quoted, counts bare — the same bytes the migration script wrote, so a rewrite by specs-bot is no diff.
 */
export function groupMetaLines(meta: GroupMeta): string[] {
  return [
    "---",
    "scope: >-",
    ...wrap(meta.scope).map((l) => `  ${l}`),
    ...list("terms", meta.terms),
    ...list("related", meta.related),
    ...(meta.open?.length ? list("open", meta.open) : []),
    ...list("binds", meta.binds),
    ...list("retired", meta.retired),
    `first-step: ${meta["first-step"]}`,
    `last-step: ${meta["last-step"]}`,
    `in-force: ${meta["in-force"]}`,
    `superseded: ${meta.superseded}`,
    "---",
  ];
}

/** A group's lines with `meta` as its block, the old block (if any) replaced; the rest untouched. */
export function withGroupMeta(lines: string[], meta: GroupMeta): string[] {
  const { end } = splitGroupMeta(lines);
  return [...groupMetaLines(meta), ...lines.slice(end)];
}
