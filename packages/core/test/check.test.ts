import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  check,
  loadStore,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  summarize,
  type Finding,
  type Store,
} from "../src/index.ts";

const STEPS = `# Steps

**The next free number is 4.**

## Language

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 · (the maintainer) | Overtaken by 3 (later) | x |  |
| 2 | q-2 · (the maintainer) | A rule | x |  |
| 3 | q-3 · (the maintainer) | A rule with \`a | b\` | x |  |
`;

const PENDING = `# Pending

the next free
number, which is **4**.

## To review

| Reviewed | Row | Answered | What |
|---|---|---|---|
| [ ] | 2 | q-2 | A rule |

## Machine 1

#### q-9 · Open

- **Measured.** Built.
`;

const TAKEN = `# Taken

## lang — the language

**Lead.**

(1) Text (2).

Steps: 2, 3
Binds: x
`;

const RETIRED = `# Retired

## Language spellings

| Retired | Replaced by | Decisions | Since / note |
|---|---|---|---|
| \`old\` | \`new\` | 2 |  |
`;

function store(over: Partial<Record<"steps" | "pending" | "taken" | "retired", string>> = {}): Store {
  return {
    specsDir: "/nowhere",
    steps: parseSteps(over.steps ?? STEPS),
    pending: parsePending(over.pending ?? PENDING),
    taken: parseTaken(over.taken ?? TAKEN),
    retired: parseRetired(over.retired ?? RETIRED),
    tree: { docs: [], versions: [], current: "" },
    chat: [],
  };
}

const codes = (fs: Finding[]) => fs.map((f) => `${f.code} ${f.about}`);

describe("check", () => {
  test("a consistent repository has only the bare-pipe warning", () => {
    expect(codes(check(store()))).toEqual(["step-bare-pipe step 3"]);
  });

  test("a next free number that disagrees with the rows", () => {
    const f = check(store({ steps: STEPS.replace("is 4.", "is 7."), pending: PENDING.replace("**4**", "**6**") }));
    expect(codes(f)).toContain("next-free-mismatch decisions-taken-steps");
    expect(codes(f)).toContain("next-free-mismatch decisions-pending");
  });

  test("a pending id a row already answers", () => {
    expect(codes(check(store({ pending: PENDING.replace("q-9 · Open", "q-2 · Open") })))).toContain("pending-already-answered pending q-2");
  });

  test("references to rows that do not exist", () => {
    const f = codes(
      check(
        store({
          taken: TAKEN.replace("Steps: 2, 3", "Steps: 2, 8"),
          retired: RETIRED.replace("| 2 |", "| 9 |"),
          steps: STEPS.replace("Overtaken by 3", "Overtaken by 5"),
        }),
      ),
    );
    expect(f).toContain("subject-step-missing subject lang");
    expect(f).toContain("retired-step-missing retired `old`");
    expect(f).toContain("step-superseded-by-missing step 1");
  });

  test("summarize counts by severity and code", () => {
    expect(summarize(check(store()))).toEqual({ "warning step-bare-pipe": 1 });
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (!(!root || !existsSync(root))) describe("check over the real repository", () => {
  const findings = check(loadStore(root));

  test("finds no error", () => {
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  test("the warnings are today's known ones", () => {
    // Pinned so a new defect shows up as a diff; fixing data lowers these numbers.
    expect(summarize(findings)).toEqual({
      "warning step-bare-pipe": 22,
      "warning subject-no-lead": 2,
      "warning doc-link-broken": 5,
      "warning chat-reply-path": 46,
    });
  });
});
