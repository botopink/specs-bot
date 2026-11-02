import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type DataSet,
  loadOverride,
  nothingToDo,
  ORDER,
  planMove,
  readDataSet,
  refusal,
  RULES,
  run,
  runOracles,
} from "./fronts-move.ts";

const H144 = "144 — the cache group (B-57 … B-64): worked now";

// A small specs-data checkout holding every shape the move handles: two folders numbered 144 (so a bare "144 —"
// heading is ambiguous), a clean front heading (150 rakun), a multi-front heading (151 json · 152 yaml) with an item
// no heading front opens (142), an "Across fronts" section, the L5 lane, the Execution order table with an old id
// one alias table holds (04 → 150-rakun), one two hold (103 → 150-rakun and 151-json) and one none holds (999),
// links in every direction between the fronts and milestone/ (which does not move), review-triage.md (to the root),
// a closed milestone's front, an examples/ folder, a language-gap marker indexed by its specs/ path, and moved.json.
const FILES: Record<string, string> = {
  "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n\nSee [rakun](150-rakun/README.md).\n\n## Machine 1\n\nNone open.\n",
  "specs/retired.md": "# Retired\n",
  "specs/decisions-taken/README.md": "# Decisions taken\n\nThe record. **The next free number is 1.** Fronts: [rakun](../150-rakun/README.md).\n\n## Groups\n\n",
  "specs/milestone/README.md": `---
milestone: 1.0.12-beta
---
# Specs — 1.0.12-beta

The fronts: [rakun](../150-rakun/README.md), [its track](../150-rakun/track.md#notes). Where each stands is
[\`status.md\`](status.md); who touches what is [\`fronts.md\`](fronts.md), its [order](fronts.md#execution-order).
`,
  "specs/milestone/language-gaps.md": `---
milestone: 1.0.12-beta
---
# Language gaps

| Gap | Owner |
|---|---|
| **gap-x** | 150 |

## Marker index

| \`specs/150-rakun/examples/a.bp\` | 1 | **gap-x** |
`,
  "specs/milestone/review-triage.md": `---
milestone: 1.0.12-beta
---
# Review triage

| # | Grade |
|---|---|
| 12 | A — holds up, see [the record](../decisions-pending.md) and [rakun](../150-rakun/README.md) |

Kept beside \`specs/milestone/review-triage.md\` once, [the status](status.md).
`,
  "specs/milestone/status.md": `---
milestone: 1.0.12-beta
date: 2026-10-11
---
# Status — 1.0.12-beta

**Fronts with open work:** 6. Lanes in [\`fronts.md\`](fronts.md) § Execution order; questions in
[\`../decisions-pending.md\`](../decisions-pending.md).

## L1 — finish what is already on \`feat\`

### First — the conformance order ([\`fronts.md\`](fronts.md) § Execution order)

In order.

- [ ] 163 s6 — a language tour · after 144 B-29 step I

### ${H144}

- [ ] 144 B-63 — \`botopink cell check --jobs <N>\` landed
- [x] 144 B-153 — a template answering \`Component<X>\`

### 150 rakun

- [ ] 150 s29 — rakun's wrappers, see [the README](../150-rakun/README.md#steps) and [the gap](language-gaps.md)
  — continued on a second line
- [x] 150 s30 — landed early

### Across fronts — a decision's sites in several fronts

- [ ] decision 321 (qualified beans) — 130 s5 · rakun 04 s6

## L3 — ready to open now

### 151 json · 152 yaml

- [ ] 151 s1 — std's \`json.bp\` out
- [ ] 142 (396) — \`json\`, \`yaml\`, one repository each
- [ ] 152 s2 — one YAML subset
Prose between the items, under the heading.

### 163 meta-ci (medium)

- [ ] 163 s9 — the measurements

## L5 — blocked on a decision

Full text in [\`../decisions-pending.md\`](../decisions-pending.md).

- [ ] 434-b — 144 B-17 · 116-a — 116 s2

## Done — landed on \`feat\`

### 150 rakun

- [x] 150 s1 — the router
`,
  "specs/milestone/fronts.md": `---
milestone: 1.0.12-beta
---
# Fronts — 1.0.12-beta: who may touch what, when

Where each front stands is [\`status.md\`](status.md). The old ids resolve through each README's alias table.

## Rules for a front

- One worktree, one owner ([rakun](../150-rakun/README.md)).

## Execution order

0. **The conformance order — worked now.**
1. **144 B-00 — comptime on wasm.**

At most six worktrees at once.

### Dependency graph (old ids)

| Front | Needs | Unblocks |
|---|---|---|
| **04** | 128 | 13 · 12 (s1) · [the track](../150-rakun/track.md) |
| **103** s2 | s1 | 128 · 22 |
| **999** | — | — |

## Gate

The standard landing, [§ Rules](#rules-for-a-front).

## Exit gate of the milestone

Every front closed.
`,
  "specs/144-checker/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 144 — machine 1: the checker\n\nSee [the status](../milestone/status.md).\n",
  "specs/144-backends-tooling/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-2\n---\n# Front 144 — machine 2: backends\n",
  "specs/150-rakun/README.md": `---
milestone: 1.0.12-beta
owner: machine-1
---
# Front 150 — rakun

See [the status](../milestone/status.md#150-rakun), [the order](../milestone/fronts.md#execution-order),
[the checker](../144-checker/README.md), [pending](../decisions-pending.md) and [the repo](../../repository/rakun/AGENTS.md).

## Steps

### 150 s29 — wrappers

- [ ] the publish-retry example

## Alias table

| Old id | Step here |
|---|---|
| \`04-rakun-erlang-runtime\` s2 | 150 s1 |
| \`103-actions-id\` open | 150 s2 |
`,
  "specs/150-rakun/track.md": "---\nmilestone: 1.0.12-beta\n---\n# Track\n\n## Notes\n\nBack to [the README](README.md) and [the milestone](../milestone/README.md).\n",
  "specs/150-rakun/examples/a.bp": "fn main() {\n  // LANGUAGE GAP gap-x\n}\n",
  "specs/150-rakun/examples/post.md": "---\ntitle: a post\n---\n# A post\n",
  "specs/151-json/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 151 — json\n\n## Alias table\n\n| Old id | Step here |\n|---|---|\n| `103-json-parse` s1 | 151 s1 |\n",
  "specs/152-yaml/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 152 — yaml\n",
  "specs/163-meta-ci/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 163 — meta-ci\n",
  "specs/010-old/README.md": "---\nmilestone: 1.0.11-beta\n---\n# Front 10 — old\n\nThe milestone then: [README](../milestone/README.md).\n",
  "moved.json": `${JSON.stringify({ "1.0.12-beta/machine-1/150-rakun/README": "150-rakun/README", "gone/old": "https://github.com/botopink/specs-data/blob/abc/gone.md" }, null, 2)}\n`,
  "conversation-chat/m1-0001.md": "a message naming specs/150-rakun/ — never touched\n",
};

function dataSet(): DataSet {
  const specs = new Map<string, Buffer>();
  for (const [p, t] of Object.entries(FILES)) if (p.startsWith("specs/")) specs.set(p.slice("specs/".length), Buffer.from(t));
  return { specs, moved: new Map(Object.entries(JSON.parse(FILES["moved.json"]!) as Record<string, string>)) };
}

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "fronts-move-test-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

const OVERRIDE = new Map([[H144, "144-checker"]]);
const s = (plan: ReturnType<typeof planMove>, p: string) => plan.after.specs.get(p)?.toString("utf8");

describe("phase 1", () => {
  const plan = planMove(dataSet(), OVERRIDE);

  test("numbered folders move under fronts/, milestone/ stays, review-triage goes to the root", () => {
    const keys = [...plan.after.specs.keys()];
    expect(keys.filter((k) => /^\d/.test(k))).toEqual([]);
    expect(keys).toContain("fronts/150-rakun/README.md");
    expect(keys).toContain("fronts/150-rakun/examples/a.bp");
    expect(keys).toContain("milestone/README.md");
    expect(keys).toContain("milestone/language-gaps.md");
    expect(keys).toContain("review-triage.md");
    expect(keys).not.toContain("milestone/review-triage.md");
    expect(keys).not.toContain("fronts/milestone/README.md");
  });

  test("links between a front and milestone/ gain or lose a ../, the rest stay as written", () => {
    const readme = s(plan, "fronts/150-rakun/README.md")!;
    expect(readme).toContain("[the status](../../milestone/order.md#150-rakun)");
    expect(readme).toContain("[the order](../../milestone/order.md#execution-order)");
    expect(readme).toContain("[the checker](../144-checker/README.md)");
    expect(readme).toContain("[pending](../../decisions-pending.md)");
    expect(readme).toContain("[the repo](../../../repository/rakun/AGENTS.md)");
    expect(s(plan, "milestone/README.md")).toContain("[rakun](../fronts/150-rakun/README.md), [its track](../fronts/150-rakun/track.md#notes)");
    expect(s(plan, "fronts/150-rakun/track.md")).toContain("[the README](README.md) and [the milestone](../../milestone/README.md)");
    expect(s(plan, "decisions-pending.md")).toContain("[rakun](fronts/150-rakun/README.md)");
    expect(s(plan, "decisions-taken/README.md")).toContain("[rakun](../fronts/150-rakun/README.md)");
    const triage = s(plan, "review-triage.md")!;
    expect(triage).toContain("[the record](decisions-pending.md) and [rakun](fronts/150-rakun/README.md)");
    expect(triage).toContain("`specs/review-triage.md`");
    expect(plan.p1.links.frontMilestone).toBeGreaterThan(0);
  });

  test("a literal specs/<front>/ mention gains fronts/", () => {
    expect(s(plan, "milestone/language-gaps.md")).toContain("| `specs/fronts/150-rakun/examples/a.bp` | 1 |");
  });

  test("one companion per eligible document: current milestone, outside examples/", () => {
    expect([...plan.p1.companions].sort()).toEqual([
      "fronts/144-backends-tooling/README---status.md",
      "fronts/144-checker/README---status.md",
      "fronts/150-rakun/README---status.md",
      "fronts/150-rakun/track---status.md",
      "fronts/151-json/README---status.md",
      "fronts/152-yaml/README---status.md",
      "fronts/163-meta-ci/README---status.md",
    ]);
    expect(s(plan, "fronts/150-rakun/track---status.md")).toBe("---\nmilestone: 1.0.12-beta\n---\n# Track — status\n");
  });

  test("--all-milestones gives the closed milestone's front a companion too", () => {
    const all = planMove(dataSet(), OVERRIDE, true);
    expect(all.p1.companions).toContain("fronts/010-old/README---status.md");
    expect(all.after.specs.get("fronts/010-old/README---status.md")!.toString()).toContain("milestone: 1.0.11-beta");
  });

  test("a companion that would overwrite a file is refused", () => {
    const data = dataSet();
    data.specs.set("150-rakun/track---status.md", Buffer.from("---\nmilestone: 1.0.12-beta\n---\n# A real doc\n"));
    const p = planMove(data, OVERRIDE);
    expect(p.p1.collisions).toEqual(["fronts/150-rakun/track---status.md"]);
    expect(runOracles(p).find((o) => o.name.startsWith("S4"))!.result.ok).toBe(false);
  });

  test("moved.json: chains collapsed, every moved document and the three milestone pages", () => {
    const m = plan.after.moved!;
    expect(m.get("1.0.12-beta/machine-1/150-rakun/README")).toBe("fronts/150-rakun/README");
    expect(m.get("150-rakun/README")).toBe("fronts/150-rakun/README");
    expect(m.get("milestone/review-triage")).toBe("review-triage");
    expect(m.get("milestone/status")).toBe("milestone/order");
    expect(m.get("milestone/fronts")).toBe("milestone/rules");
    expect(m.get("gone/old")).toMatch(/^https:/);
    expect(m.has("milestone/README")).toBe(false);
  });
});

describe("phase 2", () => {
  const plan = planMove(dataSet(), OVERRIDE);
  const rakun = s(plan, "fronts/150-rakun/README---status.md")!;
  const order = s(plan, ORDER)!;
  const rules = s(plan, RULES)!;

  test("(a) a clean front heading: every line to that front, lane and heading kept, the link rebased (g)", () => {
    expect(rakun).toContain("## L1 — finish what is already on `feat`\n\n### 150 rakun\n\n- [ ] 150 s29 — rakun's wrappers, see [the README](README.md#steps) and [the gap](../../milestone/language-gaps.md)\n  — continued on a second line\n- [x] 150 s30 — landed early");
    expect(rakun).toContain("## Done — landed on `feat`\n\n### 150 rakun\n\n- [x] 150 s1 — the router");
    expect(rakun.startsWith("---\nmilestone: 1.0.12-beta\n---\n# Front 150 — rakun — status\n")).toBe(true);
  });

  test("(b) the ambiguous 144 heading goes where --override says", () => {
    expect(s(plan, "fronts/144-checker/README---status.md")).toContain(`### ${H144}\n\n- [ ] 144 B-63`);
    expect(order).not.toContain(H144);
    expect(plan.p2.ambiguous).toEqual([]);
  });

  test("(b) without --override it is ambiguous: global, and migrate refuses naming it", () => {
    const p = planMove(dataSet());
    expect(p.p2.ambiguous.map((h) => h.heading)).toEqual([H144]);
    expect(s(p, ORDER)).toContain(`### ${H144}`);
    const outcomes = runOracles(p);
    expect(outcomes.filter((o) => !o.result.ok)).toEqual([]);
    const why = refusal(p, outcomes)!;
    expect(why).toContain(`"${H144}"`);
    expect(why).toContain("2 folders numbered 144");
  });

  test("(c) a multi-front heading: each item by its own number, the rest global under the same heading", () => {
    expect(s(plan, "fronts/151-json/README---status.md")).toContain("## L3 — ready to open now\n\n### 151 json · 152 yaml\n\n- [ ] 151 s1 — std's `json.bp` out");
    expect(s(plan, "fronts/152-yaml/README---status.md")).toContain("### 151 json · 152 yaml\n\n- [ ] 152 s2 — one YAML subset");
    expect(order).toContain("### 151 json · 152 yaml\n\n- [ ] 142 (396) — `json`, `yaml`, one repository each\nProse between the items, under the heading.");
    expect(plan.p2.counts.items.multi).toBe(2);
    expect(plan.p2.counts.items.multiGlobal).toBe(1);
  });

  test("(d) Across fronts and First stay global; (e) L5 whole", () => {
    expect(order).toContain("### Across fronts — a decision's sites in several fronts\n\n- [ ] decision 321");
    expect(order).toContain("### First — the conformance order ([`fronts.md`](order.md) § Execution order)\n\nIn order.\n\n- [ ] 163 s6");
    expect(order).toContain("## L5 — blocked on a decision\n\nFull text in [`../decisions-pending.md`](../decisions-pending.md).\n\n- [ ] 434-b");
    expect(s(plan, "fronts/163-meta-ci/README---status.md")).toContain("### 163 meta-ci (medium)\n\n- [ ] 163 s9");
  });

  test("(f) the old ids: 04 resolves to 150-rakun, 103 is ambiguous, 999 unknown", () => {
    expect(plan.p2.ids.map((i) => [i.id, i.kind, i.dir ?? null])).toEqual([
      ["04", "resolved", "150-rakun"],
      ["103", "ambiguous", null],
      ["999", "unknown", null],
    ]);
    expect(rakun).toContain("## Execution order (from fronts.md, old ids)\n\n| Front | Needs | Unblocks |\n|---|---|---|\n| **04** | 128 | 13 · 12 (s1) · [the track](track.md) |");
    expect(order).toContain("| Front | Needs | Unblocks |\n|---|---|---|\n| **103** s2 | s1 | 128 · 22 |\n| **999** | — | — |");
    const o = planMove(dataSet(), new Map([...OVERRIDE, ["103", "151-json"]]));
    expect(s(o, "fronts/151-json/README---status.md")).toContain("| **103** s2 | s1 | 128 · 22 |");
  });

  test("order.md and rules.md: the prose where it belongs, status.md and fronts.md gone", () => {
    // "[`fronts.md`](fronts.md) § Execution order": the prose after the link names the section, so order.md.
    expect(order.startsWith("---\nmilestone: 1.0.12-beta\ndate: 2026-10-11\n---\n# Order\n\n**Fronts with open work:** 6. Lanes in [`fronts.md`](order.md) § Execution order")).toBe(true);
    expect(order).toContain("## Execution order\n\n0. **The conformance order — worked now.**");
    expect(order).toContain("### Dependency graph (old ids)");
    expect(rules.startsWith("---\nmilestone: 1.0.12-beta\n---\n# Rules\n\nWhere each front stands is [`status.md`](order.md).")).toBe(true);
    expect(rules).toContain("## Rules for a front\n\n- One worktree, one owner ([rakun](../fronts/150-rakun/README.md)).");
    expect(rules).toContain("## Gate\n\nThe standard landing, [§ Rules](#rules-for-a-front).\n\n## Exit gate of the milestone");
    expect(rules).not.toContain("Execution order");
    expect(plan.after.specs.has("milestone/status.md")).toBe(false);
    expect(plan.after.specs.has("milestone/fronts.md")).toBe(false);
    expect(s(plan, "milestone/README.md")).toContain("[`status.md`](order.md); who touches what is [`fronts.md`](rules.md), its [order](order.md#execution-order)");
  });
});

describe("the oracles", () => {
  test("all fourteen pass over the fixture", () => {
    const outcomes = runOracles(planMove(dataSet(), OVERRIDE));
    expect(outcomes.length).toBe(14);
    for (const o of outcomes) expect([o.name, o.result.ok, o.result.detail]).toEqual([o.name, true, o.result.detail]);
  });

  test("a second run over the result has nothing to do", () => {
    const plan = planMove(dataSet(), OVERRIDE);
    expect(nothingToDo(planMove(plan.after))).toBe(true);
    expect(nothingToDo(plan)).toBe(false);
  });

  test("S1 catches a line lost in the relocation", () => {
    const plan = planMove(dataSet(), OVERRIDE);
    const path = "fronts/150-rakun/README---status.md";
    plan.after.specs.set(path, Buffer.from(plan.after.specs.get(path)!.toString().replace("- [x] 150 s30 — landed early\n", "")));
    expect(runOracles(plan).find((o) => o.name.startsWith("S1"))!.result.ok).toBe(false);
  });

  test("O5 catches a link that names another file", () => {
    const plan = planMove(dataSet(), OVERRIDE);
    const path = "fronts/150-rakun/track.md";
    plan.p1.specs.set(path, Buffer.from(plan.p1.specs.get(path)!.toString().replace("../../milestone/README.md", "../milestone/README.md")));
    expect(runOracles(plan).find((o) => o.name.startsWith("O5"))!.result.ok).toBe(false);
  });
});

describe("the CLI", () => {
  test("--override reads inline JSON or a file", () => {
    expect(loadOverride('{"04": "150-rakun"}').get("04")).toBe("150-rakun");
    const f = join(mkdtempSync(join(tmpdir(), "fronts-move-ovr-")), "o.json");
    writeFileSync(f, JSON.stringify({ [H144]: "global" }));
    expect(loadOverride(f).get(H144)).toBe("global");
  });

  test("dry-run writes nothing; migrate refuses an ambiguous heading without --override", async () => {
    const root = checkout();
    expect(await run("dry-run", root)).toBe(0);
    expect(existsSync(join(root, "specs/150-rakun/README.md"))).toBe(true);
    expect(await run("migrate", root)).toBe(1);
    expect(existsSync(join(root, "specs/150-rakun/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts"))).toBe(false);
  });

  test("migrate without .git: a plain rename, and the result has nothing to do", async () => {
    const root = checkout();
    expect(await run("migrate", root, JSON.stringify(Object.fromEntries(OVERRIDE)))).toBe(0);
    expect(existsSync(join(root, "specs/150-rakun"))).toBe(false);
    expect(existsSync(join(root, "specs/fronts/150-rakun/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/150-rakun/README---status.md"))).toBe(true);
    expect(existsSync(join(root, "specs/milestone/order.md"))).toBe(true);
    expect(existsSync(join(root, "specs/milestone/status.md"))).toBe(false);
    expect(existsSync(join(root, "specs/review-triage.md"))).toBe(true);
    expect(readFileSync(join(root, "conversation-chat/m1-0001.md"), "utf8")).toBe(FILES["conversation-chat/m1-0001.md"]!);
    const moved = JSON.parse(readFileSync(join(root, "moved.json"), "utf8")) as Record<string, string>;
    expect(moved["milestone/status"]).toBe("milestone/order");
    expect(nothingToDo(planMove(readDataSet(root)))).toBe(true);
  });

  test("migrate with .git: one commit with the counts, a clean tree", async () => {
    const root = checkout();
    const sh = (...args: string[]) => {
      const r = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return r.stdout.toString().trim();
    };
    sh("init", "-q");
    sh("config", "user.email", "test@example.com");
    sh("config", "user.name", "test");
    sh("add", "-A");
    sh("commit", "-q", "-m", "fixture");
    expect(await run("migrate", root, JSON.stringify(Object.fromEntries(OVERRIDE)))).toBe(0);
    expect(sh("rev-list", "--count", "HEAD")).toBe("2");
    expect(sh("status", "--porcelain")).toBe("");
    const msg = sh("log", "-1", "--format=%B");
    expect(msg).toContain("fronts-move:");
    expect(msg).toContain("rule 1 (front heading) 4");
    expect(msg).toContain("resolved 1");
    expect(sh("ls-files", "specs/fronts/150-rakun/README.md")).toBe("specs/fronts/150-rakun/README.md");
    expect(sh("ls-files", "specs/150-rakun")).toBe("");
    expect(sh("ls-files", "specs/review-triage.md")).toBe("specs/review-triage.md");
  });
});
