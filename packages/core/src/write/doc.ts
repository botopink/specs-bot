// Document writes (PLAN.md § 5.2) — the most frequent: a status checklist, a front's README.
// Each plans one change to one file; frozen milestones are refused.
import { type Doc, docMeta, sectionText } from "../docs/doc.ts";
import { type Meta, splitMeta, withMeta } from "../docs/meta.ts";
import type { Model } from "../model.ts";
import { etagOf, type Plan, WriteError } from "./plan.ts";

const pathOf = (ref: string) => `specs/${ref}.md`;

function docFor(model: Model, ref: string): Doc {
  const doc = model.docByRef.get(ref) ?? model.docByRef.get(`${ref}/README`);
  if (!doc) throw new WriteError("not-found", `doc ${ref} not found`, "specs-bot fronts / specs-bot search find one");
  if (doc.version !== model.tree.current) {
    throw new WriteError("frozen", `${doc.ref} is in ${doc.version}, a closed milestone`, `only ${model.tree.current} is written`);
  }
  return doc;
}

function sectionFor(doc: Doc, anchor: string) {
  const s = doc.sections.find((x) => x.anchor === anchor);
  if (!s) throw new WriteError("not-found", `section ${anchor} of ${doc.ref} not found`, `specs-bot doc ${doc.ref} --outline lists the anchors`);
  return s;
}

/** The text's lines without trailing blank lines; refuses an empty text. */
function bodyLines(text: string, what: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  if (!lines.join("").trim()) throw new WriteError("invalid", `${what} is empty`);
  return lines;
}

function plan(doc: Doc, op: string, anchor: string, lines: string[], message: string, summary: string): Plan {
  return {
    op,
    refs: [`${doc.ref}#${anchor}`],
    message: `spec(${doc.version}): ${message}`,
    summary,
    changes: [{ path: pathOf(doc.ref), before: doc.lines.join("\n"), after: lines.join("\n") }],
  };
}

/** The etag of a section as `specs-bot doc --section` shows it. */
export function sectionEtag(doc: Doc, anchor: string): string | undefined {
  const text = sectionText(doc, anchor);
  return text === undefined ? undefined : etagOf(text);
}

/**
 * Replace a section whole — its heading line and everything up to the next heading of its level or higher.
 * The text starts with a heading of the same level. `etag` is the one read: a section that changed since is refused.
 */
export function replaceSection(model: Model, input: { ref: string; anchor: string; text: string; etag: string }): Plan {
  const doc = docFor(model, input.ref);
  const s = sectionFor(doc, input.anchor);
  const current = etagOf(doc.lines.slice(s.start, s.end).join("\n"));
  if (input.etag !== current) {
    throw new WriteError("conflict", `section ${input.anchor} of ${doc.ref} changed since it was read`, "read it again and redo the edit over it", { etag: current });
  }
  const lines = bodyLines(input.text, "the section's text");
  const level = lines[0]!.match(/^(#{1,6}) /)?.[1]?.length;
  if (level !== s.level) {
    throw new WriteError("invalid", `the text must start with a level-${s.level} heading ("${"#".repeat(s.level)} …")`, "the heading line is part of the section");
  }
  const after = [...doc.lines.slice(0, s.start), ...lines, "", ...doc.lines.slice(s.end)];
  return plan(doc, "doc.replace", input.anchor, after, `${shortRef(doc)} § ${s.heading} rewritten`, `rewrite ${doc.ref} § ${s.heading}`);
}

/**
 * Add text at the end of a section (after its subsections). A list item or table row joins the list or table
 * the section ends with; anything else is a paragraph of its own.
 */
export function appendToSection(model: Model, input: { ref: string; anchor: string; text: string }): Plan {
  const doc = docFor(model, input.ref);
  const s = sectionFor(doc, input.anchor);
  let at = s.end;
  while (at > s.start + 1 && doc.lines[at - 1]!.trim() === "") at--;
  const lines = bodyLines(input.text, "the text");
  const prev = doc.lines[at - 1] ?? "";
  const joins = (/^\s*([-*+] |\d+\. )/.test(lines[0]!) && /^\s*([-*+] |\d+\. )/.test(prev)) || (lines[0]!.startsWith("|") && prev.startsWith("|"));
  const insert = joins ? lines : ["", ...lines];
  const after = [...doc.lines.slice(0, at), ...insert, ...doc.lines.slice(at)];
  return plan(doc, "doc.append", input.anchor, after, `${shortRef(doc)} § ${s.heading}: added`, `append to ${doc.ref} § ${s.heading}`);
}

/** Insert a new section right after another one (after its subsections), at the same level unless told. */
export function addSection(model: Model, input: { ref: string; after: string; heading: string; text: string; level?: number }): Plan {
  const doc = docFor(model, input.ref);
  const s = sectionFor(doc, input.after);
  const level = input.level ?? s.level;
  if (level < 2 || level > 6) throw new WriteError("invalid", "a section's level is 2 to 6");
  const heading = input.heading.trim();
  if (!heading || heading.includes("\n")) throw new WriteError("invalid", "the heading is one line");
  const body = bodyLines(input.text, "the section's text");
  let at = s.end;
  while (at > s.start + 1 && doc.lines[at - 1]!.trim() === "") at--;
  const after = [...doc.lines.slice(0, at), "", `${"#".repeat(level)} ${heading}`, "", ...body, ...doc.lines.slice(at)];
  if (at === s.end) after.splice(at + 3 + body.length, 0, "");
  return plan(doc, "doc.add-section", input.after, after, `${shortRef(doc)}: § ${heading} added`, `add § ${heading} to ${doc.ref}`);
}

/** A new document in the current milestone, inside a folder that already holds documents. */
export function newDoc(model: Model, input: { ref: string; text: string }): Plan {
  const ref = input.ref.replace(/\.md$/, "");
  if (model.docByRef.has(ref)) throw new WriteError("invalid", `doc ${ref} already exists`, "specs-bot doc edit changes it");
  let where;
  try {
    where = docMeta(`${ref}.md`);
  } catch {
    throw new WriteError("invalid", `${ref} is not a document ref (<front>/…/<name>)`);
  }
  const version = model.tree.placeOf(ref.split("/").slice(0, -1).join("/")).version;
  if (version !== model.tree.current) throw new WriteError("frozen", `${ref.split("/")[0]} is in ${version}, a closed milestone`, `write in a front of ${model.tree.current}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(where.name) && where.name !== "README") {
    throw new WriteError("invalid", `a document's name is lowercase words with hyphens: ${where.name}`);
  }
  const dir = ref.split("/").slice(0, -1).join("/");
  if (![...model.docByRef.keys()].some((r) => r.startsWith(`${dir}/`))) {
    throw new WriteError("invalid", `no document lives in ${dir}/ yet`, "a new front starts with its README (specs-bot front new, later)");
  }
  // The YAML block: the one the text brings, with the milestone and the owner its folder gives (meta.ts).
  const given = bodyLines(input.text, "the document");
  const { meta: brought, end, error } = splitMeta(given);
  if (error) throw new WriteError("invalid", `the metadata block: ${error}`);
  if (brought.milestone && brought.milestone !== version) throw new WriteError("invalid", `milestone: ${brought.milestone} — a new document is in ${version}`);
  if (brought.owner) throw new WriteError("invalid", "owner is a front's, set by claim / assign on its README", "specs-bot claim <front>");
  const meta: Meta = { milestone: version, ...brought };
  meta.milestone = version;
  if (!given[end]?.startsWith("# ")) throw new WriteError("invalid", 'a document starts with its title ("# …"), after its metadata block if it brings one');
  const lines = withMeta(given, meta);
  return {
    op: "doc.new",
    refs: [ref],
    message: `spec(${version}): ${ref.split("/").slice(-2).join("/")} added`,
    summary: `new document ${ref}`,
    changes: [{ path: pathOf(ref), before: null, after: `${lines.join("\n")}\n` }],
  };
}

const KEY = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;

/** Sets and removes keys of a document's metadata block; milestone is the tree's and is not set by hand. */
export function setMeta(model: Model, input: { ref: string; set?: Record<string, string>; unset?: string[] }): Plan {
  const doc = docFor(model, input.ref);
  const set = input.set ?? {};
  const unset = input.unset ?? [];
  if (!Object.keys(set).length && !unset.length) throw new WriteError("invalid", "nothing to set or unset");
  for (const k of [...Object.keys(set), ...unset]) {
    if (!KEY.test(k)) throw new WriteError("invalid", `a key is lowercase words with hyphens: ${k}`);
    if (k === "milestone") throw new WriteError("invalid", "milestone is where the document sits; it is not set by hand");
    if (k === "owner") throw new WriteError("invalid", "owner changes by claim, release or assign", "specs-bot claim <front> · release <front> · assign <front> --to <machine>");
  }
  for (const [k, v] of Object.entries(set)) if (!v.trim()) throw new WriteError("invalid", `${k} is empty; --unset removes a key`);
  const meta: Meta = { ...doc.meta };
  if (!meta.milestone) meta.milestone = doc.version;
  for (const k of unset) {
    if (!(k in meta)) throw new WriteError("not-found", `${doc.ref} has no key ${k}`);
    delete meta[k];
  }
  Object.assign(meta, set);
  const after = withMeta(doc.lines, meta);
  const what = [...Object.keys(set).map((k) => `${k} set`), ...unset.map((k) => `${k} removed`)].join(", ");
  return {
    op: "doc.meta",
    refs: [doc.ref],
    message: `spec(${doc.version}): ${shortRef(doc)}: ${what}`,
    summary: `${what} in ${doc.ref}`,
    changes: [{ path: pathOf(doc.ref), before: doc.lines.join("\n"), after: after.join("\n") }],
  };
}

/** "150-rakun/README" — the last two parts of a ref, for commit subjects. */
function shortRef(doc: Doc): string {
  return doc.ref.split("/").slice(-2).join("/");
}
