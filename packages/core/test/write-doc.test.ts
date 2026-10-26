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
    parseDoc("milestone/README.md", "# Specs\n\n**Milestone:** 1.0.12-beta\n"),
    parseDoc("milestone/status.md", STATUS),
    parseDoc("01-checker/status.md", "# Old\n\n**Milestone:** 1.0.5-beta\n\n## Done\n\nx\n"),
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

describe("newDoc", () => {
  test("a new document beside existing ones", () => {
    const p = newDoc(model, { ref: "milestone/contracts", text: "# Contracts\n\nText." });
    expect(p.changes).toEqual([{ path: "specs/milestone/contracts.md", before: null, after: "# Contracts\n\nText.\n" }]);
  });

  test("refuses an existing ref, a folder with no documents, a missing title", () => {
    expect(refused(() => newDoc(model, { ref: "milestone/status", text: "# S" })).message).toContain("already exists");
    expect(refused(() => newDoc(model, { ref: "150-nowhere/x", text: "# X" })).message).toContain("no document lives");
    expect(refused(() => newDoc(model, { ref: "milestone/notes", text: "No title" })).message).toContain("starts with its title");
  });
});
