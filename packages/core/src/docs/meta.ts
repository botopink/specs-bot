// A spec document's metadata: the YAML block at its top (the maintainer, 2026-10-26).
//
//   ---
//   milestone: 1.0.12-beta
//   owner: machine-1
//   priority: high — the library tier (decision 433)
//   depends-on: |-
//     144 B-11 (318 wrappers, 12 s5), …
//   ---
//   # Front 150 — rakun
//
// Every value is a string (a markdown fragment); `milestone` and `owner` come first, then the fields in the
// order they were written. Keys are the field names in lower case with hyphens ("Depends on" → depends-on).
import { parseDocument, stringify } from "yaml";

export type Meta = Record<string, string>;

/** The keys every document's block starts with, in this order. */
export const META_FIRST = ["milestone", "owner"] as const;

/** The metadata block of a document's lines, and the index of the first line after it (0 when there is none). */
export function splitMeta(lines: string[]): { meta: Meta; end: number; error?: string } {
  if (lines[0] !== "---") return { meta: {}, end: 0 };
  const close = lines.indexOf("---", 1);
  if (close < 0) return { meta: {}, end: 0, error: "the metadata block has no closing ---" };
  const doc = parseDocument(lines.slice(1, close).join("\n"));
  if (doc.errors.length) return { meta: {}, end: close + 1, error: doc.errors[0]!.message.split("\n")[0]! };
  const raw = doc.toJS() as unknown;
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) return { meta: {}, end: close + 1, error: "the metadata block is not a mapping" };
  const meta: Meta = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) meta[k] = v === null || v === undefined ? "" : String(v);
  return { meta, end: close + 1 };
}

/** The block's lines for a metadata map: `milestone`, `owner`, then the rest in their order; strings throughout. */
export function metaLines(meta: Meta): string[] {
  const keys = [...META_FIRST.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !(META_FIRST as readonly string[]).includes(k))];
  const body = keys.map((k) => {
    const v = meta[k]!;
    // A value of several lines is a literal block; one line is whatever YAML needs to keep it a string.
    if (v.includes("\n")) return `${k}: |${v.startsWith(" ") ? "2" : ""}-\n${v.split("\n").map((l) => (l ? `  ${l}` : "")).join("\n")}`;
    return stringify({ [k]: v }, { lineWidth: 0, minContentWidth: 0 }).replace(/\n$/, "");
  });
  return ["---", ...body.join("\n").split("\n"), "---"];
}

/** "Depends on" → "depends-on", "Machine" → "owner". */
export function metaKey(label: string): string {
  const k = label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return k === "machine" ? "owner" : k;
}

/** A document's lines with `meta` as its block, the old block (if any) replaced; the rest untouched. */
export function withMeta(lines: string[], meta: Meta): string[] {
  const { end } = splitMeta(lines);
  return [...metaLines(meta), ...lines.slice(end)];
}
