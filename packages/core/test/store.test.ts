import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadStore } from "../src/index.ts";

function write(root: string, files: Record<string, string>): void {
  for (const [p, t] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
}

const COMMON = {
  "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n\n## Machine 1\n\nNone open.\n",
  "specs/retired.md": "# Retired\n",
};

// The new decisions-taken/ layout: a README index plus one file per group — module-system and std carry
// prose (lead, paragraphs, Steps, Binds), unfiled is a plain group with none (the shape a liso group takes).
const RECORD_FILES: Record<string, string> = {
  ...COMMON,
  "specs/decisions-taken/README.md": `# Decisions taken

The rules in force. **The next free number is 116.**

## Groups

- module-system
- std
- unfiled
`,
  "specs/decisions-taken/module-system.md": `# module-system — files, modules and imports

**A file is a module.**

(1) Every \`.bp\` is a module.

Steps: 107
Binds: every repository

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 107 | 1.0.1-beta · (the maintainer, 2026-09-01) | Every \`.bp\` is a module | every repository | mod_cell |
`,
  "specs/decisions-taken/std.md": `# std — the standard library's surface

**What std holds.**

Steps: 115
Binds: std

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 115 | 1.0.2-beta · (the maintainer, 2026-09-05) | What std holds | std | std_cell |
`,
  "specs/decisions-taken/unfiled.md": `# unfiled — not yet grouped

## Record

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 12 | some-id | some rule | some binds | some cell |
`,
};

function tempStore(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-store-"));
  write(root, files);
  return loadStore(root);
}

describe("loadStore — the new decisions-taken/ directory layout", () => {
  const store = tempStore(RECORD_FILES);

  test("record is present, one GroupDoc per listed group", () => {
    expect(store.record).toBeDefined();
    expect([...store.record!.groups.keys()]).toEqual(["module-system", "std", "unfiled"]);
  });

  test("steps.rows is every group's rows, in the README's order, numbered within each group", () => {
    expect(store.steps.rows.map((r) => r.num)).toEqual([107, 115, 12]);
  });

  test("row.section is the group's slug, not group.ts's internal \"Record\"", () => {
    expect(store.steps.rows.map((r) => r.section)).toEqual(["module-system", "std", "unfiled"]);
  });

  test("statedNextFree comes from the README, not a steps.md head", () => {
    expect(store.steps.statedNextFree).toBe(116);
  });

  test("taken.subjects holds one Subject per group with prose; a plain group (unfiled) is not a subject", () => {
    expect(store.taken.subjects.map((s) => s.slug)).toEqual(["module-system", "std"]);
  });

  test("a subject's fields mirror its group's", () => {
    const ms = store.taken.subjects.find((s) => s.slug === "module-system")!;
    expect(ms.summary).toBe("files, modules and imports");
    expect(ms.lead).toBe("A file is a module.");
    expect(ms.paragraphs).toEqual(["(1) Every `.bp` is a module."]);
    expect(ms.steps).toEqual([107]);
    expect(ms.binds).toBe("every repository");
  });
});
