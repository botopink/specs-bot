import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildIndex, loadStore, parseDoc, parsePending, parseRetired, parseSteps, parseTaken, snippet, type Store } from "../src/index.ts";

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
  tree: {
    current: "1.0.12-beta",
    versions: ["1.0.5-beta", "1.0.12-beta"],
    docs: [
      parseDoc("1.0.12-beta/machine-1/150-rakun/README.md", "# Front 150 — rakun\n\n## Steps\n\nThe router reads opaque routes.\n\n### s1\n\nRouting detail.\n"),
      parseDoc("1.0.5-beta/01-checker/README.md", "# Checker\n\nOld opaque notes.\n"),
    ],
  },
  chat: [],
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
    expect(keys()).toEqual(["1.0.12-beta/machine-1/150-rakun/README#steps"]);
    expect(keys({ frozen: true })).toContain("1.0.5-beta/01-checker/README#checker");
    expect(keys({ version: "1.0.5-beta" })).toEqual(["1.0.5-beta/01-checker/README#checker"]);
  });

  test("a section is its own text, not its subsections'", () => {
    expect(index.search("routing detail", { kinds: ["section"] })[0]!.key).toBe("1.0.12-beta/machine-1/150-rakun/README#s1");
    expect(index.search("routing detail", { kinds: ["section"] }).map((h) => h.key)).not.toContain(
      "1.0.12-beta/machine-1/150-rakun/README#steps",
    );
  });

  test("scope filters leave out what has no scope", () => {
    expect(index.search("opaque", { machine: "machine-1" }).every((h) => h.kind === "section")).toBe(true);
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

const root = process.env.SPECS_DATA_PATH ?? "";

describe.skipIf(!root || !existsSync(root))("search over the real repository", () => {
  const start = performance.now();
  const index = buildIndex(loadStore(root));
  const ms = performance.now() - start;

  test("builds in a few seconds", () => {
    expect(ms).toBeLessThan(5000);
  });

  test("a refusal code finds the question that names it", () => {
    expect(index.search("for-await-one-source")[0]).toMatchObject({ kind: "pending", key: "956-a" });
  });

  test("a rule's words find its step", () => {
    expect(index.search("opaque type constructor private", { kinds: ["step"] }).map((h) => h.key)).toContain("814");
  });
});
