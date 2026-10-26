import { describe, expect, test } from "bun:test";
import {
  addSection,
  appendToSection,
  buildModel,
  newDoc,
  parseDoc,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  placeDocs,
  replaceSection,
  sectionEtag,
  setMeta,
  splitMeta,
  WriteError,
} from "../src/index.ts";

const STATUS = `# Status — 1.0.12-beta

## Done

- [x] a
- [x] b

## Open

- [ ] c

### Detail

Text.

## Notes

Last.
`;

const model = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(""),
  pending: parsePending(""),
  taken: parseTaken(""),
  retired: parseRetired(""),
  tree: placeDocs([
    parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
    parseDoc("milestone/status.md", STATUS),
    parseDoc("01-checker/status.md", "---\nmilestone: 1.0.5-beta\n---\n# Old\n\n## Done\n\nx\n"),
  ]),
  chat: [],
});
const doc = model.docByRef.get("milestone/status")!;
const after = (p: { changes: { after: string }[] }) => p.changes[0]!.after;

function refused(fn: () => unknown): WriteError {
  try {
    fn();
  } catch (e) {
    if (e instanceof WriteError) return e;
    throw e;
  }
  throw new Error("not refused");
}

describe("replaceSection", () => {
  test("replaces heading to the next heading of its level, subsections included", () => {
    const p = replaceSection(model, { ref: "milestone/status", anchor: "open", text: "## Open\n\n- [ ] c\n- [ ] d\n", etag: sectionEtag(doc, "open")! });
    expect(after(p)).toBe(STATUS.replace("- [ ] c\n\n### Detail\n\nText.\n", "- [ ] c\n- [ ] d\n"));
    expect([p.op, p.refs, p.changes[0]!.path]).toEqual(["doc.replace", ["milestone/status#open"], "specs/milestone/status.md"]);
    expect(p.message).toBe("spec(1.0.12-beta): milestone/status § Open rewritten");
  });

  test("the last section keeps the file's final newline", () => {
    const p = replaceSection(model, { ref: "milestone/status", anchor: "notes", text: "## Notes\n\nNew.", etag: sectionEtag(doc, "notes")! });
    expect(after(p).endsWith("## Notes\n\nNew.\n")).toBe(true);
  });

  test("a stale etag is a conflict that carries the current one", () => {
    const e = refused(() => replaceSection(model, { ref: "milestone/status", anchor: "open", text: "## Open\n", etag: "old" }));
    expect([e.code, e.status, e.detail?.etag]).toEqual(["conflict", 409, sectionEtag(doc, "open")]);
  });

  test("the text must start with a heading of the section's level", () => {
    expect(refused(() => replaceSection(model, { ref: "milestone/status", anchor: "open", text: "### Open\n", etag: sectionEtag(doc, "open")! })).code).toBe("invalid");
  });

  test("a closed milestone is refused", () => {
    expect(refused(() => replaceSection(model, { ref: "01-checker/status", anchor: "done", text: "## Done\n", etag: "x" })).code).toBe("frozen");
  });
});

describe("appendToSection", () => {
  test("a list item joins the list the section ends with", () => {
    const p = appendToSection(model, { ref: "milestone/status", anchor: "done", text: "- [x] c" });
    expect(after(p)).toBe(STATUS.replace("- [x] b\n", "- [x] b\n- [x] c\n"));
  });

  test("a paragraph is its own, after the subsections", () => {
    const p = appendToSection(model, { ref: "milestone/status", anchor: "open", text: "Later." });
    expect(after(p)).toBe(STATUS.replace("Text.\n\n## Notes", "Text.\n\nLater.\n\n## Notes"));
  });
});

describe("addSection", () => {
  test("inserts after a section and its subsections", () => {
    const p = addSection(model, { ref: "milestone/status", after: "open", heading: "Blocked", text: "- [ ] e" });
    expect(after(p)).toBe(STATUS.replace("Text.\n\n## Notes", "Text.\n\n## Blocked\n\n- [ ] e\n\n## Notes"));
  });

  test("after the last section the file still ends in one newline", () => {
    const p = addSection(model, { ref: "milestone/status", after: "notes", heading: "End", text: "Z." });
    expect(after(p).endsWith("Last.\n\n## End\n\nZ.\n")).toBe(true);
  });
});

// A model with a front its README gives an owner, to see a new document inherit it.
const owned = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(""),
  pending: parsePending(""),
  taken: parseTaken(""),
  retired: parseRetired(""),
  tree: placeDocs([
    parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
    parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\npriority: high\n---\n# Front 150\n\n## Steps\n\nx\n"),
    parseDoc("01-checker/README.md", "---\nmilestone: 1.0.5-beta\n---\n# Old\n"),
  ]),
  chat: [],
});

describe("newDoc", () => {
  test("a new document beside existing ones, its metadata block first: the current milestone", () => {
    const p = newDoc(model, { ref: "milestone/contracts", text: "# Contracts\n\nText." });
    expect(p.changes).toEqual([
      { path: "specs/milestone/contracts.md", before: null, after: "---\nmilestone: 1.0.12-beta\n---\n# Contracts\n\nText.\n" },
    ]);
  });

  test("the owner comes from the front; keys the text brings are kept", () => {
    const plain = after(newDoc(owned, { ref: "150-rakun/track", text: "# Track\n" }));
    expect(plain).toBe("---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Track\n");
    const brought = after(newDoc(owned, { ref: "150-rakun/notes", text: "---\nowner: machine-2\nwave: \"3\"\n---\n# Notes\n" }));
    expect(splitMeta(brought.split("\n")).meta).toEqual({ milestone: "1.0.12-beta", owner: "machine-2", wave: "3" });
    expect(brought).toEndWith("---\n# Notes\n");
  });

  test("refuses an existing ref, a folder with no documents, a missing title, another milestone", () => {
    expect(refused(() => newDoc(model, { ref: "milestone/status", text: "# S" })).message).toContain("already exists");
    expect(refused(() => newDoc(model, { ref: "150-nowhere/x", text: "# X" })).message).toContain("no document lives");
    expect(refused(() => newDoc(model, { ref: "milestone/notes", text: "No title" })).message).toContain("starts with its title");
    expect(refused(() => newDoc(model, { ref: "milestone/notes", text: "---\nmilestone: 1.0.5-beta\n---\n# N" })).message).toContain("milestone: 1.0.5-beta");
    expect(refused(() => newDoc(model, { ref: "milestone/notes", text: "---\nmilestone: [\n---\n# N" })).message).toContain("metadata block");
    expect(refused(() => newDoc(owned, { ref: "01-checker/notes", text: "# N" })).code).toBe("frozen");
  });
});

describe("setMeta", () => {
  const readme = () => owned.docByRef.get("150-rakun/README")!;

  test("sets and removes keys; the body is left as it was", () => {
    const p = setMeta(owned, { ref: "150-rakun/README", set: { owner: "machine-2", "depends-on": "144 B-11\nand B-12" }, unset: ["priority"] });
    expect(p.op).toBe("doc.meta");
    expect(p.refs).toEqual(["150-rakun/README"]);
    expect(p.message).toBe("spec(1.0.12-beta): 150-rakun/README: owner set, depends-on set, priority removed");
    const text = after(p);
    expect(splitMeta(text.split("\n")).meta).toEqual({ milestone: "1.0.12-beta", owner: "machine-2", "depends-on": "144 B-11\nand B-12" });
    expect(text).toContain("depends-on: |-\n  144 B-11\n  and B-12\n");
    expect(text.slice(text.indexOf("# Front 150"))).toBe(readme().lines.slice(splitMeta(readme().lines).end).join("\n"));
  });

  test("a document with no block gets one, its milestone first", () => {
    const text = after(setMeta(model, { ref: "milestone/status", set: { owner: "machine-1" } }));
    expect(text.startsWith("---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Status — 1.0.12-beta\n")).toBe(true);
  });

  test("refuses the milestone, a bad key, an empty value, a missing key, nothing to do, a frozen document", () => {
    const r = (input: Parameters<typeof setMeta>[1], m = owned) => refused(() => setMeta(m, input));
    expect(r({ ref: "150-rakun/README", set: { milestone: "2.0.0" } }).message).toContain("not set by hand");
    expect(r({ ref: "150-rakun/README", set: { Owner: "x" } }).message).toContain("lowercase words");
    expect(r({ ref: "150-rakun/README", set: { owner: "  " } }).message).toContain("is empty");
    expect(r({ ref: "150-rakun/README", unset: ["wave"] }).code).toBe("not-found");
    expect(r({ ref: "150-rakun/README" }).message).toContain("nothing to set");
    expect(r({ ref: "01-checker/README", set: { owner: "machine-1" } }).code).toBe("frozen");
  });
});
