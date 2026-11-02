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
    parseDoc("fronts/150-rakun/README.md", README),
    parseDoc("fronts/150-rakun/04-rakun/track.md", "# Track 04\n\n- [ ] not a step of the README\n"),
    parseDoc("fronts/135-snap/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 135 — snap\n\nCoordination only.\n"),
    parseDoc("fronts/135-snap/20-snap/context.md", "# Front 135 — snap: the evaluation\n"),
    parseDoc("fronts/151-json/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 151 — json\n"),
  ]),
  chat: [],
  record: { readme: { lines: [], order: [] }, groups: new Map() },
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
    expect(p.steps[0]).toMatchObject({ text: "the core's open boxes (04)", source: "readme", href: "/docs/fronts/150-rakun/README#150-s1--the-cores-open-boxes-04" });
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

// The same status content as STATUS above, but already relocated the way scripts/fronts-move.ts's migration
// (botopink/projects) moves it once it has actually run: each front's own README---status.md companion, plus
// milestone/order.md for the lines no single front owns (rules.md stays empty here — it never holds a
// checkbox). TEMPORARY fixture, dropped together with progress.ts's dual-layout read once the old layout
// (milestone/status.md) is no longer possible in production.
const STATUS_150 = `---
milestone: 1.0.12-beta
---
# Front 150 — rakun — status

## L1 — finish what is already on \`feat\`

### 150 rakun

- [x] 150 s31 — landed today
- [ ] 150 s56 — the dev loop
`;

const STATUS_135 = `---
milestone: 1.0.12-beta
---
# Front 135 — snap — status

## Done — landed on \`feat\`

### 135 snap

- [x] 135 s0 (391) — the \`snap\` library
`;

const STATUS_151 = `---
milestone: 1.0.12-beta
---
# Front 151 — json — status
`;

const ORDER = `---
milestone: 1.0.12-beta
---
# Status — 1.0.12-beta — order

## L1 — finish what is already on \`feat\`

### Across fronts — a decision's sites

- [ ] decision 307 (a derived type) — 01-checker s28 · 135 s2

## L4 — later

### 151 json · 135 snap (medium)

- [ ] the json schema — both fronts

## L5 — blocked on a decision

- [ ] 150 s3 — waits on 9-c
`;

const model2 = buildModel({
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
    parseDoc("milestone/order.md", ORDER),
    parseDoc("fronts/150-rakun/README.md", README),
    parseDoc("fronts/150-rakun/README---status.md", STATUS_150),
    parseDoc("fronts/150-rakun/04-rakun/track.md", "# Track 04\n\n- [ ] not a step of the README\n"),
    parseDoc("fronts/135-snap/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 135 — snap\n\nCoordination only.\n"),
    parseDoc("fronts/135-snap/README---status.md", STATUS_135),
    parseDoc("fronts/135-snap/20-snap/context.md", "# Front 135 — snap: the evaluation\n"),
    parseDoc("fronts/151-json/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 151 — json\n"),
    parseDoc("fronts/151-json/README---status.md", STATUS_151),
  ]),
  chat: [],
  record: { readme: { lines: [], order: [] }, groups: new Map() },
});

const progress2 = buildProgress(model2, "1.0.12-beta");

describe("buildProgress — both layouts agree", () => {
  // href carries the source document's path, which legitimately differs between layouts (milestone/status vs.
  // each front's own README---status, or milestone/order); the .status items' relative order across documents
  // is not meaningful either (that's what scripts/fronts-move.ts's own S3 oracle checks: the same items per
  // front, state, lane and label — as a set, not an order). Everything else (steps, waiting, binds, basis,
  // counts) must match exactly, order included.
  const normalized = (p: ReturnType<typeof buildProgress>) =>
    [...p.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([num, fp]) => [
        num,
        { ...fp, status: fp.status.map(({ href, ...rest }) => JSON.stringify(rest)).sort() },
      ]);

  test("milestone/status.md whole, or its front companions plus milestone/order.md, read to the same progress", () => {
    expect(model.docByRef.has("milestone/status")).toBe(true);
    expect(model2.docByRef.has("milestone/status")).toBe(false);
    expect(normalized(progress2)).toEqual(normalized(progress));
  });

  test("front 135's status items still resolve by number even though they moved to milestone/order.md", () => {
    // Its own README---status.md (just the Done item) reads before milestone/order.md (the rest): a different
    // order than the old single-document layout, which the oracle-style comparison above treats as equivalent.
    expect(progress2.get(135)!.status.map((s) => [s.lane, s.state, s.label])).toEqual([
      ["Done", "done", "135 s0 (391)"],
      ["L1", "open", "decision 307 (a derived type)"],
      ["L4", "open", "the json schema"],
    ]);
  });

  test("the href of a new-layout item points at its own file", () => {
    expect(progress2.get(135)!.status[0]!.href).toBe("/docs/fronts/135-snap/README---status#135-snap");
    expect(progress2.get(150)!.status[2]!.href).toBe("/docs/milestone/order#l5--blocked-on-a-decision");
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
      expect(p.steps.every((s) => s.href.startsWith("/docs/fronts/150-rakun/README#"))).toBe(true);
    });

    test("144's steps add up over its folders on both machines", () => {
      const refs = new Set(all.get(144)!.steps.map((s) => s.href.split("#")[0]));
      expect(refs.size).toBeGreaterThan(1);
    });
  });
