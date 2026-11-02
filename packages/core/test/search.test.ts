import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildIndex, loadStore, parseDoc, parseGroup, parsePending, parseRecordReadme, parseRetired, parseSteps, parseTaken, placeDocs, snippet, type Store, units } from "../src/index.ts";

const store: Store = {
  specsDir: "/nowhere",
  steps: parseSteps(`## Language

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 814 | q-8 · (the maintainer) | **An opaque type's constructor is private to the type.** | \`m-1/144\` | opaque_private |
| 815 | q-9 · (the maintainer) | A component is a function again. | x |  |
`),
  pending: parsePending(`## Machine 1

#### 956-a · The choices the build made
- **Measured.** It refuses \`for-await-one-source\` and reads ranges.
`),
  taken: parseTaken(`## lang — the language

**Types are nominal.**

(1) An opaque record hides its fields.

Steps: 814
Binds: x
`),
  retired: parseRetired(`## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`@Task<T>\` | \`Async<T>\` | 814 |  |
`),
  tree: placeDocs([
    parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n\n## Steps\n\nThe router reads opaque routes.\n\n### s1\n\nRouting detail.\n"),
    parseDoc("01-checker/README.md", "---\nmilestone: 1.0.5-beta\n---\n# Checker\n\nOld opaque notes.\n"),
  ]),
  chat: [],
  // units() only formats this into a file path (specs/decisions-taken/<slug>.md); nothing here reads the
  // directory, so an empty in-memory record is enough for a Store that buildIndex alone runs over.
  record: { readme: { lines: [], order: [] }, groups: new Map() },
};

describe("buildIndex", () => {
  const index = buildIndex(store);

  test("one unit per step, pending, subject, retired row and document section", () => {
    expect(index.size).toBe(2 + 1 + 1 + 1 + 3 + 1);
  });

  test("finds a step by its words", () => {
    expect(index.search("opaque constructor")[0]).toMatchObject({ kind: "step", key: "814" });
  });

  test("a literal code outranks fuzzy matches", () => {
    expect(index.search("for-await-one-source")[0]).toMatchObject({ kind: "pending", key: "956-a" });
  });

  test("filters by kind", () => {
    expect(index.search("opaque", { kinds: ["subject"] }).map((h) => h.key)).toEqual(["lang"]);
  });

  test("a closed milestone's sections are left out unless asked for", () => {
    const keys = (o = {}) => index.search("opaque", { kinds: ["section"], ...o }).map((h) => h.key);
    expect(keys()).toEqual(["150-rakun/README#steps"]);
    expect(keys({ frozen: true })).toContain("01-checker/README#checker");
    expect(keys({ version: "1.0.5-beta" })).toEqual(["01-checker/README#checker"]);
  });

  test("a section is its own text, not its subsections'", () => {
    expect(index.search("routing detail", { kinds: ["section"] })[0]!.key).toBe("150-rakun/README#s1");
    expect(index.search("routing detail", { kinds: ["section"] }).map((h) => h.key)).not.toContain(
      "150-rakun/README#steps",
    );
  });

  test("scope filters leave out what has no scope", () => {
    expect(index.search("opaque", { owner: "machine-1" }).every((h) => h.kind === "section")).toBe(true);
  });
});

describe("snippet", () => {
  test("centres on the first matched term and marks the cuts", () => {
    const s = snippet(`${"a ".repeat(200)}needle ${"b ".repeat(200)}`, ["needle"], 40);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("needle");
  });
});

// Under the new decisions-taken/ directory layout, a step's and a subject's unit points at its own group's
// file, not a shared decisions-taken-steps.md / decisions-taken.md (store.ts rewrites r.section to the slug).
describe("units — the decisions-taken/ directory layout", () => {
  const group = parseGroup(`# module-system — files, modules and imports

**A file is a module.**

Steps: 107
Binds: x

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 107 | q-1 | A rule | x |  |
`);
  const recordStore: Store = {
    specsDir: "/nowhere",
    steps: { lines: [], rows: group.rows.map((r) => ({ ...r, section: group.slug })) },
    pending: parsePending(""),
    taken: { lines: [], head: [], subjects: [{ slug: group.slug, summary: group.summary, lead: group.lead, paragraphs: group.paragraphs, steps: group.steps, binds: group.binds, lines: group.lines, line: 0 }] },
    retired: parseRetired(""),
    tree: placeDocs([]),
    chat: [],
    record: { readme: parseRecordReadme("# Decisions taken\n\n## Groups\n\n- module-system\n"), groups: new Map([["module-system", group]]) },
  };

  test("a step's file is its group's, not decisions-taken-steps.md", () => {
    expect(units(recordStore).find((u) => u.kind === "step")!.file).toBe("specs/decisions-taken/module-system.md");
  });

  test("a subject's file is its group's, not decisions-taken.md", () => {
    expect(units(recordStore).find((u) => u.kind === "subject")!.file).toBe("specs/decisions-taken/module-system.md");
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!root || !existsSync(root))) describe("search over the real repository", () => {
  const start = performance.now();
  const index = buildIndex(loadStore(root));
  const ms = performance.now() - start;

  test("builds in a few seconds", () => {
    expect(ms).toBeLessThan(5000);
  });

  test("a refusal code finds what names it first: the question while open, the step once answered (956-a → 963)", () => {
    const top = index.search("for-await-one-source")[0];
    expect([top?.kind, top?.key]).toBeOneOf([
      ["pending", "956-a"],
      ["step", "963"],
    ]);
  });

  test("a rule's words find its step", () => {
    expect(index.search("opaque type constructor private", { kinds: ["step"] }).map((h) => h.key)).toContain("814");
  });
});
