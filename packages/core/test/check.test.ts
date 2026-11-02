import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  check,
  loadStore,
  parsePending,
  parseRetired,
  parseSteps,
  parseDoc,
  parseTaken,
  placeDocs,
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

// checkRecord (group-missing / group-unlisted) reads the decisions-taken/ directory straight off disk, so a
// Store built in memory for the checks below still needs a real (empty) one to read — one tmp dir for every
// store(), its record empty and in agreement with the empty directory.
const specsRoot = mkdtempSync(join(tmpdir(), "specs-bot-check-base-"));
mkdirSync(join(specsRoot, "decisions-taken"), { recursive: true });

function store(over: Partial<Record<"steps" | "pending" | "taken" | "retired", string>> = {}): Store {
  return {
    specsDir: specsRoot,
    steps: parseSteps(over.steps ?? STEPS),
    pending: parsePending(over.pending ?? PENDING),
    taken: parseTaken(over.taken ?? TAKEN),
    retired: parseRetired(over.retired ?? RETIRED),
    tree: placeDocs([]),
    chat: [],
    record: { readme: { lines: [], order: [] }, groups: new Map() },
  };
}

const codes = (fs: Finding[]) => fs.map((f) => `${f.code} ${f.about}`);

describe("check", () => {
  test("a consistent repository has only the bare-pipe warning", () => {
    expect(codes(check(store()))).toEqual(["step-bare-pipe step 3"]);
  });

  test("every spec document carries its metadata block with its milestone; examples/ are samples", () => {
    const s = store();
    s.tree = placeDocs([
      parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
      parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150\n"),
      parseDoc("150-rakun/track.md", "# Track — no block\n"),
      parseDoc("150-rakun/notes.md", "---\nowner: machine-1\n---\n# Notes — a block with no milestone\n"),
      parseDoc("150-rakun/bad.md", "---\nowner: [machine-1\n---\n# Bad\n"),
      parseDoc("150-rakun/examples/post.md", "---\ntitle: A post\n---\n# A post\n"),
    ]);
    const f = check(s).filter((x) => x.code.startsWith("doc-meta"));
    expect(codes(f).sort()).toEqual(["doc-meta-invalid 150-rakun/bad", "doc-meta-missing 150-rakun/notes", "doc-meta-missing 150-rakun/track"]);
    expect(f.every((x) => x.severity === "error")).toBe(true);
  });

  test("a next free number that disagrees with the rows", () => {
    const f = check(store({ steps: STEPS.replace("is 4.", "is 7."), pending: PENDING.replace("**4**", "**6**") }));
    expect(codes(f)).toContain("next-free-mismatch decisions-taken/README");
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

// The new decisions-taken/ directory layout: the README's listing of groups diverges from the files really on
// disk in both directions — a listed slug with no file, and a file no slug lists.
function recordStore(over: { groups?: string[]; extraFile?: string } = {}): Store {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-check-"));
  const write = (p: string, t: string) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  };
  write("specs/decisions-pending.md", "the next free\nnumber, which is **108**.\n\n## Machine 1\n\nNone open.\n");
  write("specs/retired.md", "# Retired\n");
  const groups = over.groups ?? ["module-system", "ghost"];
  write(
    "specs/decisions-taken/README.md",
    `# Decisions taken\n\nThe rules in force. **The next free number is 108.**\n\n## Groups\n\n${groups.map((g) => `- ${g}`).join("\n")}\n`,
  );
  write(
    "specs/decisions-taken/module-system.md",
    "# module-system — files, modules and imports\n\n## Record\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 107 | q-1 | A rule | x |  |\n",
  );
  if (over.extraFile) {
    write(`specs/decisions-taken/${over.extraFile}.md`, `# ${over.extraFile} — an unlisted group\n\n## Record\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n`);
  }
  return loadStore(root);
}

describe("check — the decisions-taken/ directory layout", () => {
  test("a slug the README lists with no matching file is group-missing", () => {
    expect(codes(check(recordStore()))).toContain("group-missing group ghost");
  });

  test("a file on disk the README does not list is group-unlisted", () => {
    expect(codes(check(recordStore({ groups: ["module-system"], extraFile: "stray" })))).toContain("group-unlisted group stray");
  });

  test("a consistent directory has neither", () => {
    const f = codes(check(recordStore({ groups: ["module-system"] })));
    expect(f).not.toContain("group-missing group module-system");
    expect(f.some((c) => c.startsWith("group-unlisted"))).toBe(false);
  });

  test("next-free-mismatch is about the README under this layout", () => {
    const s = recordStore({ groups: ["module-system"] });
    s.steps.statedNextFree = 999;
    expect(codes(check(s))).toContain("next-free-mismatch decisions-taken/README");
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
    // Pinned so a new defect shows up as a diff; fixing data lowers these numbers. (The flattening took the 5
    // broken links away: they were in closed milestones' documents.)
    expect(summarize(findings)).toEqual({
      "warning step-bare-pipe": 22,
      "warning subject-no-lead": 2,
      "warning chat-reply-path": 46,
    });
  });
});
