import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildModel, loadModel, parseDoc, parsePending, parseRetired, parseSteps, parseTaken, placeDocs } from "../src/index.ts";

const model = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(`**The next free number is 4.**

## Language

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1, q-2 · (the maintainer) | Overtaken by 3 (later) | x |  |
| 3 | q-3 · (the maintainer) | A rule | x |  |
`),
  pending: parsePending(`the next free\nnumber, which is **4**.\n\n## Machine 1\n\n#### q-9 · Open\n- **Measured.** Built.\n`),
  taken: parseTaken(`## lang — the language\n\n**Lead.**\n\nText.\n\nSteps: 1, 3\nBinds: x\n`),
  retired: parseRetired(`## Language spellings\n\n| Retired | Replaced by | Decisions | Since / note |\n|---|---|---|---|\n| a | b | 3 |  |\n`),
  tree: placeDocs([
    parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n"),
    parseDoc("150-rakun/04-rakun/track.md", "# Track 04\n"),
    parseDoc("milestone/status.md", "# Status\n"),
  ]),
  chat: [],
});

describe("buildModel", () => {
  test("cross-indexes steps, subjects and retired rows", () => {
    expect(model.subjectsByStep.get(3)!.map((s) => s.slug)).toEqual(["lang"]);
    expect(model.retiredByStep.get(3)!.map((r) => r.retired)).toEqual(["a"]);
    expect(model.supersedes.get(3)!.map((r) => r.num)).toEqual([1]);
  });

  test("knows which step answered a pending id", () => {
    expect([model.answeredBy.get("q-1"), model.answeredBy.get("q-2"), model.answeredBy.get("q-9")]).toEqual([1, 1, undefined]);
  });

  test("the next free number and what each file states", () => {
    expect(model.nextFree).toBe(4);
    expect(model.statedNextFree).toEqual({ steps: 4, pending: 4 });
  });

  test("a front is a numbered folder at the top, titled by its README, its milestone and machine its README's", () => {
    expect(model.fronts).toEqual([
      {
        version: "1.0.12-beta",
        machine: "machine-1",
        num: 150,
        slug: "rakun",
        ref: "150-rakun",
        title: "Front 150 — rakun",
        readme: "150-rakun/README",
        docs: ["150-rakun/README", "150-rakun/04-rakun/track"],
      },
    ]);
  });

  test("the search index is built on first use", () => {
    expect(model.index.search("rule")[0]).toMatchObject({ kind: "step", key: "3" });
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";
if (root && existsSync(root))
  describe("the real model", () => {
    const real = loadModel(root);

    test("the current milestone's fronts have titles", () => {
      const current = real.fronts.filter((f) => f.version === real.tree.current);
      expect(current.length).toBeGreaterThanOrEqual(25);
      expect(current.find((f) => f.num === 150)!.title).toStartWith("Front 150");
    });

    test("no open question is already answered", () => {
      expect(real.entries.filter((e) => real.answeredBy.has(e.id)).map((e) => e.id)).toEqual([]);
    });
  });
