// scripts/frontmatter.ts: the one-off move of the `**Key:**` header fields into each document's YAML block.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { splitMeta } from "../src/index.ts";

const SCRIPT = join(import.meta.dir, "../../../scripts/frontmatter.ts");

const FILES: Record<string, string> = {
  "specs/decisions-taken.md": "# Decisions\n\n**Milestone:** not a spec document\n",
  "specs/milestone/README.md": "# Specs — 1.0.12-beta\n\n**Milestone:** 1.0.12-beta\n\nThe milestone.\n",
  "specs/milestone/machine-1.md": "# Machine 1\n\nThe queue.\n",
  "specs/150-rakun/README.md": [
    "# Front 150 — rakun",
    "",
    "**Milestone:** 1.0.12-beta",
    "**Machine:** machine-1",
    "**Priority:** high — the library tier",
    "**Depends on:** 144 B-11 (`wrapWith`),",
    "B-12 and decision 299",
    "**Wave:** 3",
    "",
    "Group A → group B.",
    "",
    "## Steps",
    "",
    "**Gate:** inside a section, not a field.",
    "",
  ].join("\n"),
  "specs/150-rakun/04-rakun/track.md": "# Track 04\n\n**Track:** 04 · rakun\n\n- [ ] a box\n",
  "specs/150-rakun/notes.md": "# Notes\n\nNo fields here.\n",
  "specs/150-rakun/examples/post.md": "---\ntitle: Hello\n---\n# A post\n",
  "specs/01-checker/README.md": "# Checker\n\n**Milestone:** 1.0.5-beta\n**Prioridade:** alta\n\nOld.\n",
};

function run(): { root: string; out: string; code: number } {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-fm-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  const r = Bun.spawnSync(["bun", SCRIPT, root], { stdout: "pipe", stderr: "pipe" });
  return { root, out: r.stdout.toString() + r.stderr.toString(), code: r.exitCode };
}

const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const metaOf = (root: string, p: string) => splitMeta(read(root, p).split("\n")).meta;

describe("scripts/frontmatter.ts", () => {
  const { root, out, code } = run();

  test("it runs over every spec document and names the current milestone", () => {
    expect(code).toBe(0);
    expect(out).toContain("6 documents, current milestone 1.0.12-beta");
  });

  test("a front's fields become its block: milestone, owner, then the rest; a continuation line stays in its value", () => {
    expect(metaOf(root, "specs/150-rakun/README.md")).toEqual({
      milestone: "1.0.12-beta",
      owner: "machine-1",
      priority: "high — the library tier",
      "depends-on": "144 B-11 (`wrapWith`),\nB-12 and decision 299",
      wave: "3",
    });
    // The fields leave the body; a bold line inside a section is text, kept.
    const text = read(root, "specs/150-rakun/README.md");
    expect(text.slice(text.indexOf("# Front 150"))).toBe("# Front 150 — rakun\n\nGroup A → group B.\n\n## Steps\n\n**Gate:** inside a section, not a field.\n");
  });

  test("a document below a front gets the milestone and owner it inherited, explicitly", () => {
    expect(metaOf(root, "specs/150-rakun/notes.md")).toEqual({ milestone: "1.0.12-beta", owner: "machine-1" });
    expect(read(root, "specs/150-rakun/notes.md")).toEndWith("---\n# Notes\n\nNo fields here.\n");
    expect(metaOf(root, "specs/150-rakun/04-rakun/track.md")).toEqual({ milestone: "1.0.12-beta", owner: "machine-1", track: "04 · rakun" });
  });

  test("the milestone's documents: its README, a machine's page owned by that machine", () => {
    expect(metaOf(root, "specs/milestone/README.md")).toEqual({ milestone: "1.0.12-beta" });
    expect(metaOf(root, "specs/milestone/machine-1.md")).toEqual({ milestone: "1.0.12-beta", owner: "machine-1" });
  });

  test("an old front keeps its milestone; a Portuguese label is a key too", () => {
    expect(metaOf(root, "specs/01-checker/README.md")).toEqual({ milestone: "1.0.5-beta", prioridade: "alta" });
  });

  test("examples/ and the decision files at specs/'s root are left alone", () => {
    expect(read(root, "specs/150-rakun/examples/post.md")).toBe(FILES["specs/150-rakun/examples/post.md"]!);
    expect(read(root, "specs/decisions-taken.md")).toBe(FILES["specs/decisions-taken.md"]!);
  });
});
