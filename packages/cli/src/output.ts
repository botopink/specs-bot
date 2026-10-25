// Output: TOON by default (compact for a model to read), JSON for parsing, text for people.
// A document's markdown is content, not data: it is printed as it is, after a one-line head.
import { encode } from "@toon-format/toon";

export type Format = "toon" | "json" | "text";

export function render(value: unknown, format: Format): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  if (isRecord(value) && typeof value.text === "string") {
    const { text, ...head } = value;
    const meta = format === "toon" ? encode(head) : textOf(head);
    return `${meta}\n---\n${text}`;
  }
  return format === "toon" ? encode(value) : textOf(value);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Indented `key: value` lines; arrays of records as one line per record. */
export function textOf(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}(none)`;
    return value
      .map((v) => (isRecord(v) ? `${indent}- ${Object.values(v).map(scalar).join(" · ")}` : `${indent}- ${scalar(v)}`))
      .join("\n");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([k, v]) => (isRecord(v) || Array.isArray(v) ? `${indent}${k}:\n${textOf(v, `${indent}  `)}` : `${indent}${k}: ${scalar(v)}`))
      .join("\n");
  }
  return `${indent}${scalar(value)}`;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (isRecord(v) || Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}
