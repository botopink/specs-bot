import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { buildModel, loadModel, parseDoc, parsePending, parseRetired, parseSteps, parseTaken, placeDocs } from "@specs-bot/core";
import { buildProgress, namesFront, percent } from "../src/progress.ts";

const README = `---
milestone: 1.0.12-beta
owner: machine-1
---
# Front 150 — rakun

## Steps

### 150 s1 — the core's open boxes (04)

#### Step 2 — Boot options

- [x] a banner
- [x] bannerMode off

### 150 s2 — the rows handed in

- [x] one
- [ ] two

### 150 s3 — TLS bundles

- [ ] three

### B-9 — a step of another front's label style

- [ ] four

### 999 s1 — another front's step, not this one's
`;

const STATUS = `# Status — 1.0.12-beta

## L1 — finish what is already on \`feat\`

### 150 rakun

- [x] 150 s31 — landed today
- [ ] 150 s56 — the dev loop

### Across fronts — a decision's sites

- [ ] decision 307 (a derived type) — 01-checker s28 · 135 s2

## L4 — later

### 151 json · 135 snap (medium)

- [ ] the json schema — both fronts

## L5 — blocked on a decision

- [ ] 150 s3 — waits on 9-c

## Done — landed on \`feat\`

### 135 snap

- [x] 135 s0 (391) — the \`snap\` library
`;

const model = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(`## L

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 | A rule | \`machine-1/150\` s3 |  |
| 2 | q-2 | Overtaken by 3 (later) | \`machine-1/150\` |  |
| 3 | q-3 | Another | front 135 |  |
`),
  pending: parsePending(`## Machine 1

#### 9-c · Does the TLS bundle reload?

- **Measured.** 150 s3 reads it once.
- **Blocks.** \`machine-1/150\` s3.
`),
  taken: parseTaken(""),
  retired: parseRetired(""),
  tree: placeDocs([
    parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
    parseDoc("milestone/status.md", STATUS),
    parseDoc("150-rakun/README.md", README),
    parseDoc("150-rakun/04-rakun/track.md", "# Track 04\n\n- [ ] not a step of the README\n"),
    parseDoc("135-snap/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 135 — snap\n\nCoordination only.\n"),
    parseDoc("135-snap/20-snap/context.md", "# Front 135 — snap: the evaluation\n"),
    parseDoc("151-json/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 151 — json\n"),
  ]),
  chat: [],
});

const progress = buildProgress(model, "1.0.12-beta");

describe("buildProgress — the README's steps", () => {
  const p = progress.get(150)!;

  test("a step is its heading and the boxes under it, subsections included", () => {
    expect(p.steps.map((s) => [s.label, s.state, s.boxes])).toEqual([
      ["150 s1", "done", { done: 2, total: 2 }],
      ["150 s2", "open", { done: 1, total: 2 }],
      ["150 s3", "blocked", { done: 0, total: 1 }],
      ["150 B-9", "open", { done: 0, total: 1 }],
    ]);
  });

  test("each step links to its heading and says what it is", () => {
    expect(p.steps[0]).toMatchObject({ text: "the core's open boxes (04)", source: "readme", href: "/docs/150-rakun/README#150-s1--the-cores-open-boxes-04" });
  });

  test("the counts come from the README when it has steps", () => {
    expect([p.basis, p.counts, percent(p.counts)]).toEqual(["readme", { done: 1, open: 2, blocked: 1 }, 25]);
  });

  test("the questions naming the front are what it waits on", () => {
    expect(p.waiting.map((w) => [w.label, w.state, w.href])).toEqual([["9-c", "blocked", "/pending/9-c"]]);
  });

  test("in-force rows whose binds name the front", () => {
    expect(p.binds).toEqual([1]);
  });
});

describe("buildProgress — status.md", () => {
  test("an item names its front by its leading number; its lane decides its state", () => {
    expect(progress.get(150)!.status.map((s) => [s.lane, s.state, s.label])).toEqual([
      ["L1", "done", "150 s31"],
      ["L1", "open", "150 s56"],
      ["L5", "blocked", "150 s3"],
    ]);
  });

  test("without a leading number: the ### heading's numbers, else the labels in the text", () => {
    const snap = progress.get(135)!.status.map((s) => [s.lane, s.state, s.label]);
    expect(snap).toEqual([
      ["L1", "open", "decision 307 (a derived type)"],
      ["L4", "open", "the json schema"],
      ["Done", "done", "135 s0 (391)"],
    ]);
    expect(progress.get(151)!.status.map((s) => s.label)).toEqual(["the json schema"]);
  });

  test("a front whose README has no steps counts from status.md, and says so", () => {
    const p = progress.get(135)!;
    expect([p.basis, p.counts]).toEqual(["status", { done: 1, open: 2, blocked: 0 }]);
    expect(progress.get(135)!.status[2]!.href).toBe("/docs/milestone/status#135-snap");
  });
});

describe("namesFront", () => {
  test("front N, a path ending in N, N sK, N B-K — never a bigger number or a decimal", () => {
    expect(["front 150", "`machine-1/150` s3", "150 s31", "150 B-9", "Front 150 —"].map((t) => namesFront(t, 150))).toEqual([true, true, true, true, true]);
    expect(["1150 s3", "front 1500", "1.150 s3", "decision 150", "150 steps"].map((t) => namesFront(t, 150))).toEqual([false, false, false, false, false]);
  });
});

const root = process.env.SPECS_DATA_PATH ?? "";

// Only declared when the real data is here: a skipped describe still runs its body to collect tests.
if (root && existsSync(root))
  describe("progress over the real milestone", () => {
    const real = loadModel(root);
    const start = performance.now();
    const all = buildProgress(real, real.tree.current);
    const ms = performance.now() - start;

    test("is gathered for every front, quickly", () => {
      const fronts = new Set(real.tree.docs.filter((d) => d.version === real.tree.current && d.front).map((d) => d.front!.num));
      expect([...all.keys()].sort((a, b) => a - b)).toEqual([...fronts].sort((a, b) => a - b));
      expect(ms).toBeLessThan(1000);
    });

    test("front 135, whose README has no steps, counts from status.md: s0 done, the rest open", () => {
      const p = all.get(135)!;
      expect(p.basis).toBe("status");
      expect(p.status.find((s) => s.label.startsWith("135 s0"))!.state).toBe("done");
      expect(p.counts.open).toBeGreaterThan(0);
    });

    test("front 150's README steps carry their boxes", () => {
      const p = all.get(150)!;
      expect(p.basis).toBe("readme");
      expect(p.steps[0]!.label).toBe("150 s1");
      expect(p.steps.every((s) => s.href.startsWith("/docs/150-rakun/README#"))).toBe(true);
    });

    test("144's steps add up over its folders on both machines", () => {
      const refs = new Set(all.get(144)!.steps.map((s) => s.href.split("#")[0]));
      expect(refs.size).toBeGreaterThan(1);
    });
  });
