import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type DataSet, readDataSet } from "./fronts-move.ts";
import { nothingToDo, oracleNoCollision, planFlatten, run, runOracles } from "./flatten-groups.ts";

// A small specs-data checkout, already in the fronts/ layout, holding every shape flatten-groups handles:
//
//   fronts/05-emilia/README.md             — the parent front, stays (its own content, and a link out)
//   fronts/05-emilia/track.md               — directly in the front, in no group, stays
//   fronts/05-emilia/44-emilia-transitions/notes.md
//                                            — a group with NO README of its own: the created one inherits
//                                              milestone + owner; its own link goes OUT of the group
//                                              (../README.md → the parent's), gaining a segment
//   fronts/05-emilia/46-emilia-forms/README.md, .../help.md
//                                            — a group whose own README already states milestone AND a
//                                              *different* owner: gains nothing extra
//   fronts/08-misc/README.md                — another front, owner machine-3
//   fronts/08-misc/70-misc-extra/README.md  — a group with a README but NO metadata block at all: both
//                                              fields are added; its number (70) collides with 70-widgets
//   fronts/70-widgets/README.md             — an unrelated front already numbered 70; also links INTO the
//                                              group from outside the parent front
//   fronts/09-ephemeral/91-ephemeral-sub/README.md
//                                            — a front whose every document sits in its one group: once
//                                              promoted, 09-ephemeral keeps nothing and disappears
const FILES: Record<string, string> = {
  "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n",
  "specs/retired.md": "# Retired\n",
  "specs/decisions-taken/README.md": "# Decisions taken\n\nThe record. **The next free number is 1.**\n\n## Groups\n\n",
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs — 1.0.12-beta\n",
  "specs/fronts/05-emilia/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 5 — emilia\n\nSee [the track](track.md).\n",
  "specs/fronts/05-emilia/track.md": "---\nmilestone: 1.0.12-beta\n---\n# Track\n",
  "specs/fronts/05-emilia/44-emilia-transitions/notes.md":
    "---\nmilestone: 1.0.12-beta\n---\n# Notes\n\nBack to [the front](../README.md).\n",
  "specs/fronts/05-emilia/46-emilia-forms/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-2\n---\n# Front 46 — emilia forms\n",
  "specs/fronts/05-emilia/46-emilia-forms/help.md": "---\nmilestone: 1.0.12-beta\n---\n# Help\n",
  "specs/fronts/08-misc/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-3\n---\n# Front 8 — misc\n",
  "specs/fronts/08-misc/70-misc-extra/README.md": "# Front 70 — misc extra\n",
  "specs/fronts/70-widgets/README.md":
    "---\nmilestone: 1.0.12-beta\nowner: machine-5\n---\n# Front 70 — widgets\n\nSee [emilia transitions](../05-emilia/44-emilia-transitions/notes.md).\n",
  "specs/fronts/09-ephemeral/91-ephemeral-sub/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-4\n---\n# Front 91 — ephemeral sub\n",
};

function dataSet(): DataSet {
  const specs = new Map<string, Buffer>();
  for (const [p, t] of Object.entries(FILES)) if (p.startsWith("specs/")) specs.set(p.slice("specs/".length), Buffer.from(t));
  return { specs };
}

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "flatten-groups-test-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

const OVERRIDE = new Map([["08-misc/70-misc-extra", "270-misc-extra"]]);
const s = (plan: ReturnType<typeof planFlatten>, p: string) => plan.after.specs.get(p)?.toString("utf8");

describe("the plan", () => {
  const plan = planFlatten(dataSet(), OVERRIDE);

  test("every group found, one promotion per (front, group)", () => {
    expect(plan.groups.map((g) => g.key)).toEqual(["05-emilia/44-emilia-transitions", "05-emilia/46-emilia-forms", "08-misc/70-misc-extra", "09-ephemeral/91-ephemeral-sub"]);
  });

  test("a group moves straight under fronts/, at its own number unless overridden", () => {
    const keys = [...plan.after.specs.keys()];
    expect(keys).toContain("fronts/44-emilia-transitions/notes.md");
    expect(keys).toContain("fronts/46-emilia-forms/README.md");
    expect(keys).toContain("fronts/270-misc-extra/README.md");
    expect(keys).not.toContain("fronts/70-misc-extra/README.md");
    expect(keys).not.toContain("fronts/05-emilia/44-emilia-transitions/notes.md");
  });

  test("the parent front keeps what was in no group", () => {
    const keys = [...plan.after.specs.keys()];
    expect(keys).toContain("fronts/05-emilia/README.md");
    expect(keys).toContain("fronts/05-emilia/track.md");
    expect(keys).toContain("fronts/08-misc/README.md");
  });

  test("a front left with nothing of its own disappears", () => {
    const keys = [...plan.after.specs.keys()];
    expect(keys.some((k) => k.startsWith("fronts/09-ephemeral/"))).toBe(false);
    expect(keys).toContain("fronts/91-ephemeral-sub/README.md");
  });

  test("a link from outside the parent front into the group drops the parent's segment", () => {
    expect(s(plan, "fronts/70-widgets/README.md")).toContain("[emilia transitions](../44-emilia-transitions/notes.md)");
  });

  test("a link from inside the group out to the parent gains the parent's segment", () => {
    expect(s(plan, "fronts/44-emilia-transitions/notes.md")).toContain("[the front](../05-emilia/README.md)");
  });

  test("a group with no README of its own gets a minimal one, milestone and owner inherited", () => {
    expect(s(plan, "fronts/44-emilia-transitions/README.md")).toBe("---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 44 — emilia-transitions\n");
    expect(plan.created).toEqual(["fronts/44-emilia-transitions/README.md"]);
  });

  test("a group's README with no metadata block gains both fields, inherited from its front", () => {
    expect(s(plan, "fronts/270-misc-extra/README.md")).toBe("---\nmilestone: 1.0.12-beta\nowner: machine-3\n---\n# Front 70 — misc extra\n");
  });

  test("a group's README that already states milestone and its own owner gains nothing extra", () => {
    expect(s(plan, "fronts/46-emilia-forms/README.md")).toBe("---\nmilestone: 1.0.12-beta\nowner: machine-2\n---\n# Front 46 — emilia forms\n");
  });

  test("moved.json: one entry per promoted document", () => {
    const m = plan.after.moved!;
    expect(m.get("fronts/05-emilia/44-emilia-transitions/notes")).toBe("fronts/44-emilia-transitions/notes");
    expect(m.get("fronts/05-emilia/46-emilia-forms/README")).toBe("fronts/46-emilia-forms/README");
    expect(m.get("fronts/08-misc/70-misc-extra/README")).toBe("fronts/270-misc-extra/README");
    expect(m.get("fronts/09-ephemeral/91-ephemeral-sub/README")).toBe("fronts/91-ephemeral-sub/README");
    // The group gained its own README out of nothing: no old ref to point from.
    expect([...m.values()]).not.toContain("fronts/44-emilia-transitions/README");
  });
});

describe("collisions", () => {
  test("70-misc-extra's number collides with 70-widgets, so it auto-resolves instead of standing", () => {
    const plan = planFlatten(dataSet());
    expect(plan.collisions).toEqual([]);
    expect(plan.renumbered).toEqual([{ key: "08-misc/70-misc-extra", from: "70-misc-extra", to: "71-misc-extra" }]);
  });

  test("an override forces a different number than the auto-assigned one", () => {
    const plan = planFlatten(dataSet(), OVERRIDE);
    expect(plan.collisions).toEqual([]);
    expect(plan.renumbered).toEqual([]);
    expect(plan.dest.get("08-misc/70-misc-extra")).toBe("270-misc-extra");
  });

  test("dry-run resolves it on its own, no refusal", async () => {
    const root = checkout();
    expect(await run("dry-run", root)).toBe(0);
    expect(existsSync(join(root, "specs/fronts/08-misc/70-misc-extra/README.md"))).toBe(true); // dry-run writes nothing
  });

  test("migrate resolves it on its own, naming the number it picked", async () => {
    const root = checkout();
    expect(await run("migrate", root)).toBe(0);
    expect(existsSync(join(root, "specs/fronts/08-misc/70-misc-extra/README.md"))).toBe(false);
    expect(existsSync(join(root, "specs/fronts/71-misc-extra/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/70-misc-extra"))).toBe(false); // 70 stayed 70-widgets's
  });
});

describe("a group named exactly like its own front", () => {
  // specs/fronts/50-carry/50-carry/ — a leftover of the pre-flatten nesting: the group's full slug IS
  // its front's. It must merge straight into 50-carry, never alias onto (and clobber) 50-carry's own
  // README, which the old destOf/readmeFixesOf did (a Set silently collapsed the two identical names).
  const SELF: Record<string, string> = {
    "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n",
    "specs/retired.md": "# Retired\n",
    "specs/decisions-taken/README.md": "# Decisions taken\n\nThe record. **The next free number is 1.**\n\n## Groups\n\n",
    "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs — 1.0.12-beta\n",
    "specs/fronts/50-carry/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-7\npriority: high\n---\n# Front 50 — carry\n",
    "specs/fronts/50-carry/50-carry/context.md": "---\nmilestone: 1.0.12-beta\n---\n# Context\n",
  };
  function selfDataSet(): DataSet {
    const specs = new Map<string, Buffer>();
    for (const [p, t] of Object.entries(SELF)) specs.set(p.slice("specs/".length), Buffer.from(t));
    return { specs };
  }

  test("the group's files land directly in the front; the front's own README is untouched", () => {
    const plan = planFlatten(selfDataSet());
    const readme = plan.after.specs.get("fronts/50-carry/README.md")!.toString("utf8");
    expect(readme).toContain("priority: high");
    expect(readme).toContain("# Front 50 — carry");
    expect(plan.after.specs.get("fronts/50-carry/context.md")!.toString("utf8")).toContain("# Context");
    expect(plan.after.specs.has("fronts/50-carry/50-carry")).toBe(false);
    expect(plan.selfMerge.has("50-carry/50-carry")).toBe(true);
    expect(plan.created).toEqual([]); // no new front, nothing to create a README for
    expect(plan.selfMergeConflicts).toEqual([]);
  });

  test("every oracle passes", () => {
    const outcomes = runOracles(planFlatten(selfDataSet()));
    for (const o of outcomes) expect([o.name, o.result.ok]).toEqual([o.name, true]);
  });
});

describe("the oracles", () => {
  test("all seven pass over the fixture, override applied", () => {
    const outcomes = runOracles(planFlatten(dataSet(), OVERRIDE));
    expect(outcomes.length).toBe(7);
    for (const o of outcomes) expect([o.name, o.result.ok, o.result.detail]).toEqual([o.name, true, o.result.detail]);
  });

  test("a second run over the result has nothing to do", () => {
    const plan = planFlatten(dataSet(), OVERRIDE);
    expect(nothingToDo(planFlatten(plan.after))).toBe(true);
    expect(nothingToDo(plan)).toBe(false);
  });

  test("O1 catches a line lost in the move", () => {
    const plan = planFlatten(dataSet(), OVERRIDE);
    const path = "fronts/44-emilia-transitions/notes.md";
    plan.after.specs.set(path, Buffer.from(plan.after.specs.get(path)!.toString().replace("# Notes\n\n", "")));
    expect(runOracles(plan).find((o) => o.name.startsWith("O1"))!.result.ok).toBe(false);
  });

  test("O2 catches a meta field changed beyond what the fix added", () => {
    const plan = planFlatten(dataSet(), OVERRIDE);
    const path = "fronts/270-misc-extra/README.md";
    const text = plan.after.specs.get(path)!.toString();
    plan.after.specs.set(path, Buffer.from(text.replace("owner: machine-3", "owner: machine-9")));
    const o2 = runOracles(plan).find((o) => o.name.startsWith("O2"))!.result;
    expect(o2.ok).toBe(false);
  });

  test("O5 catches a link that now names another file", () => {
    const plan = planFlatten(dataSet(), OVERRIDE);
    const path = "fronts/44-emilia-transitions/notes.md";
    plan.after.specs.set(path, Buffer.from(plan.after.specs.get(path)!.toString().replace("../05-emilia/README.md", "../08-misc/README.md")));
    expect(runOracles(plan).find((o) => o.name.startsWith("O5"))!.result.ok).toBe(false);
  });
});

describe("a group nested inside a group", () => {
  // specs/fronts/60-base/61-mid/62-inner/ — 61-mid only shows up once 62-inner's own front/group parsing
  // sees it as a front (docMeta reads at most two numbered segments at a time), so one planFlatten pass
  // only promotes 61-mid; 62-inner needs a second pass over the result. The CLI's run() loops for this.
  const DEEP: Record<string, string> = {
    "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n",
    "specs/retired.md": "# Retired\n",
    "specs/decisions-taken/README.md": "# Decisions taken\n\nThe record. **The next free number is 1.**\n\n## Groups\n\n",
    "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs — 1.0.12-beta\n",
    "specs/fronts/60-base/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-6\n---\n# Front 60 — base\n",
    "specs/fronts/60-base/61-mid/62-inner/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 62 — inner\n",
  };
  function deepCheckout(): string {
    const root = mkdtempSync(join(tmpdir(), "flatten-groups-deep-"));
    for (const [p, t] of Object.entries(DEEP)) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), t);
    }
    return root;
  }

  test("one pass only reaches 61-mid; 62-inner is still nested in it", () => {
    const plan = planFlatten({ specs: (() => { const m = new Map<string, Buffer>(); for (const [p, t] of Object.entries(DEEP)) m.set(p.slice("specs/".length), Buffer.from(t)); return m; })() });
    expect(plan.groups.map((g) => g.key)).toEqual(["60-base/61-mid"]);
    expect(nothingToDo(planFlatten(plan.after))).toBe(false); // 61-mid/62-inner is next
  });

  test("dry-run projects every pass and writes nothing", async () => {
    const root = deepCheckout();
    expect(await run("dry-run", root)).toBe(0);
    expect(existsSync(join(root, "specs/fronts/60-base/61-mid/62-inner/README.md"))).toBe(true);
  });

  test("migrate loops until both levels are flattened", async () => {
    const root = deepCheckout();
    expect(await run("migrate", root)).toBe(0);
    expect(existsSync(join(root, "specs/fronts/61-mid/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/62-inner/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/60-base/61-mid"))).toBe(false);
    expect(nothingToDo(planFlatten(readDataSet(root)))).toBe(true);
  });
});

describe("fronts that already reuse a number across unrelated, frozen milestones", () => {
  // A real tree keeps "01-std" (1.0.10-beta) and "01-test-green" (1.0.0-beta) side by side: each
  // closed milestone kept its own front numbering, so a leading number is reused on purpose and this
  // script must never treat that pre-existing reuse as a collision of its own making — only a number a
  // *placement* (a promoted or renumbered group) lands on is its business.
  const REUSE: Record<string, string> = {
    "specs/decisions-pending.md": "the next free\nnumber, which is **1**.\n",
    "specs/retired.md": "# Retired\n",
    "specs/decisions-taken/README.md": "# Decisions taken\n\nThe record. **The next free number is 1.**\n\n## Groups\n\n",
    "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs — 1.0.12-beta\n",
    "specs/fronts/01-std/README.md": "---\nmilestone: 1.0.10-beta\nowner: machine-1\n---\n# Front 1 — std\n",
    "specs/fronts/01-test-green/README.md": "---\nmilestone: 1.0.0-beta\nowner: machine-2\n---\n# Front 1 — test green\n",
    "specs/fronts/80-carry/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-3\n---\n# Front 80 — carry\n",
    "specs/fronts/80-carry/12-carry-extra/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Front 12 — carry extra\n",
  };
  function reuseDataSet(): DataSet {
    const specs = new Map<string, Buffer>();
    for (const [p, t] of Object.entries(REUSE)) specs.set(p.slice("specs/".length), Buffer.from(t));
    return { specs };
  }

  test("the pre-existing 01/01 reuse is not reported, not even as a safety-net collision", () => {
    const plan = planFlatten(reuseDataSet());
    expect(plan.collisions).toEqual([]);
    expect(plan.renumbered).toEqual([]); // 12-carry-extra's own number is free
    expect(oracleNoCollision(plan).ok).toBe(true);
  });

  test("every oracle still passes, 01-std and 01-test-green both untouched", () => {
    const plan = planFlatten(reuseDataSet());
    const outcomes = runOracles(plan);
    for (const o of outcomes) expect([o.name, o.result.ok]).toEqual([o.name, true]);
    expect(plan.after.specs.has("fronts/01-std/README.md")).toBe(true);
    expect(plan.after.specs.has("fronts/01-test-green/README.md")).toBe(true);
  });
});

describe("the CLI", () => {
  test("dry-run writes nothing", async () => {
    const root = checkout();
    expect(await run("dry-run", root, JSON.stringify(Object.fromEntries(OVERRIDE)))).toBe(0);
    expect(existsSync(join(root, "specs/fronts/05-emilia/44-emilia-transitions"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/44-emilia-transitions"))).toBe(false);
  });

  test("migrate without .git: a plain rename, and the result has nothing to do", async () => {
    const root = checkout();
    expect(await run("migrate", root, JSON.stringify(Object.fromEntries(OVERRIDE)))).toBe(0);
    expect(existsSync(join(root, "specs/fronts/05-emilia/44-emilia-transitions"))).toBe(false);
    expect(existsSync(join(root, "specs/fronts/44-emilia-transitions/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/44-emilia-transitions/notes.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/270-misc-extra/README.md"))).toBe(true);
    expect(existsSync(join(root, "specs/fronts/09-ephemeral"))).toBe(false);
    expect(existsSync(join(root, "specs/fronts/05-emilia/README.md"))).toBe(true);
    const moved = JSON.parse(readFileSync(join(root, "moved.json"), "utf8")) as Record<string, string>;
    expect(moved["fronts/08-misc/70-misc-extra/README"]).toBe("fronts/270-misc-extra/README");
    expect(nothingToDo(planFlatten(readDataSet(root)))).toBe(true);
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
    expect(msg).toContain("flatten-groups:");
    expect(msg).toContain("4 group(s) promoted");
    expect(sh("ls-files", "specs/fronts/44-emilia-transitions/notes.md")).toBe("specs/fronts/44-emilia-transitions/notes.md");
    expect(sh("ls-files", "specs/fronts/05-emilia/44-emilia-transitions")).toBe("");
    expect(sh("ls-files", "specs/fronts/09-ephemeral")).toBe("");
  });
});
