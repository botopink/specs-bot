import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSteps, parseTaken } from "../packages/core/src/index.ts";
import {
  migrate,
  oracleCheckParity,
  oracleNextFree,
  oracleProseFidelity,
  oracleRenderLedgerRoundtrip,
  oracleRowMultiset,
  oracleUnitsParity,
  planSplit,
  runOracles,
  type OracleInput,
  type SplitResult,
} from "./split-record.ts";

// Six rows: 1 and 6 belong to "alpha" alone (one citation each); 3 and 5 belong to "beta" alone (one citation
// each); 2 is cited by alpha, beta and gamma — alpha comes first in STEPS below's own order, so 2 is alpha's
// despite three citers; 4 is cited by nobody, so it is unfiled's. 5 is "Overtaken by 6": 5 is beta's, 6 is
// alpha's, so that pair crosses a group boundary once split.
const STEPS = `**The next free number is 7.**

## Group A

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 1 | q-1 | Rule one | bind1 | cell1 |
| 2 | q-2 | Rule two | bind2 | cell2 |
| 4 | q-4 | Rule four | bind4 | cell4 |
| 5 | q-5 | Overtaken by 6 | bind5 | cell5 |

## Group B

| # | Id | Rule in force | Binds | Cell |
|---|---|---|---|---|
| 3 | q-3 | Rule three | bind3 | cell3 |
| 6 | q-6 | Rule six | bind6 | cell6 |
`;

// gamma cites step 2 too, but alpha (first in this file's order) owns it, so gamma's own Record table ends up
// empty — its prose (lead, paragraph, Steps, Binds) stays exactly as written here regardless.
const TAKEN = `# Decisions taken

## alpha — the alpha subject

**Alpha leads.**

(1) Alpha text.

Steps: 1, 2, 6
Binds: alpha-binds

## beta — the beta subject

**Beta leads.**

(1) Beta text.

Steps: 2, 3, 5
Binds: beta-binds

## gamma — the gamma subject

**Gamma leads.**

(1) Gamma text.

Steps: 2
Binds: gamma-binds
`;

function orig(): OracleInput {
  return { steps: parseSteps(STEPS), taken: parseTaken(TAKEN) };
}

describe("planSplit", () => {
  const result = planSplit(STEPS, TAKEN);

  test("owns every row by the 0/1/2+-citations rule, first citer wins a tie", () => {
    expect([...result.ownerOf.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [1, "alpha"],
      [2, "alpha"], // 2+ citers (alpha, beta, gamma); alpha is first in TAKEN's own order
      [3, "beta"],
      [4, "unfiled"], // no citer
      [5, "beta"],
      [6, "alpha"],
    ]);
  });

  test("the citation-count counts", () => {
    expect(result.counts).toEqual({ zero: 1, one: 4, many: 1, overridden: 0 });
  });

  test("groups: every subject in TAKEN's order, then unfiled since row 4 uses it", () => {
    expect(result.groups).toEqual(["alpha", "beta", "gamma", "unfiled"]);
  });

  test("gamma's group keeps its prose but an empty Record table (no row of its own)", () => {
    const text = result.groupText.get("gamma")!;
    expect(text).toContain("**Gamma leads.**");
    expect(text).toContain("Steps: 2");
    expect(text).toContain("Binds: gamma-binds");
    expect(text).toContain("| # | Id | Rule in force | Binds | Cell |");
    expect(text).not.toMatch(/^\| \d/m);
  });

  test("alpha's and beta's Record tables hold their own rows, in number order", () => {
    expect(result.groupText.get("alpha")).toContain("| 1 | q-1 |");
    expect(result.groupText.get("alpha")).toContain("| 2 | q-2 |");
    expect(result.groupText.get("alpha")).toContain("| 6 | q-6 |");
    expect(result.groupText.get("beta")).toContain("| 3 | q-3 |");
    expect(result.groupText.get("beta")).toContain("| 5 | q-5 |");
  });

  test("unfiled holds row 4 alone, with no prose", () => {
    const text = result.groupText.get("unfiled")!;
    expect(text).toContain("# unfiled — decisions no subject cites");
    expect(text).toContain("| 4 | q-4 |");
    expect(text).not.toContain("Steps:");
    expect(text).not.toContain("Binds:");
  });

  test("the README names the next free number and every group, unfiled last", () => {
    expect(result.readmeText).toContain("**The next free number is 7.**");
    expect(result.readmeText.match(/^- (.+)$/gm)).toEqual(["- alpha", "- beta", "- gamma", "- unfiled"]);
  });

  test("the 5→6 supersede pair crosses beta → alpha", () => {
    expect(result.crossGroupSupersedes).toEqual([{ from: 5, to: 6, fromGroup: "beta", toGroup: "alpha" }]);
  });

  test("every oracle passes on the unmodified split", () => {
    for (const { name, result: r } of runOracles(orig(), result)) expect([name, r.ok, r.detail]).toEqual([name, true, r.detail]);
  });
});

describe("planSplit — override", () => {
  test("an override replaces the rule's answer, and is counted only when it actually changes it", () => {
    const result = planSplit(STEPS, TAKEN, new Map([[4, "beta"]]));
    expect(result.ownerOf.get(4)).toBe("beta");
    expect(result.counts.overridden).toBe(1);
    expect(result.groups).toEqual(["alpha", "beta", "gamma"]); // unfiled is never used now
    expect(result.groupText.get("beta")).toContain("| 4 | q-4 |");
  });

  test("an override that agrees with the rule changes nothing and is not counted", () => {
    const result = planSplit(STEPS, TAKEN, new Map([[1, "alpha"]]));
    expect(result.ownerOf.get(1)).toBe("alpha");
    expect(result.counts.overridden).toBe(0);
  });
});

describe("the six oracles, isolated — all PASS on the matching fixture pair", () => {
  const result = planSplit(STEPS, TAKEN);
  const cases: [string, (o: OracleInput, r: SplitResult) => { ok: boolean; detail: string }][] = [
    ["row multiset", oracleRowMultiset],
    ["prose fidelity", oracleProseFidelity],
    ["check() parity", oracleCheckParity],
    ["next-free consistency", oracleNextFree],
    ["units() parity", oracleUnitsParity],
    ["renderLedger round trip", oracleRenderLedgerRoundtrip],
  ];
  for (const [name, fn] of cases) {
    test(name, () => {
      const r = fn(orig(), result);
      expect(r.ok).toBe(true);
    });
  }
});

describe("the six oracles — each catches an injected divergence", () => {
  const result = planSplit(STEPS, TAKEN);

  test("row multiset: a row dropped from its group's table fails, naming the missing row", () => {
    const broken: SplitResult = { ...result, groupText: new Map(result.groupText) };
    broken.groupText.set("alpha", broken.groupText.get("alpha")!.replace("| 6 | q-6 | Rule six | bind6 | cell6 |\n", ""));
    const r = oracleRowMultiset(orig(), broken);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("q-6");
  });

  test("prose fidelity: a group's lead edited away from its subject's fails, naming the slug", () => {
    const broken: SplitResult = { ...result, groupText: new Map(result.groupText) };
    broken.groupText.set("alpha", broken.groupText.get("alpha")!.replace("**Alpha leads.**", "**Alpha leads differently.**"));
    const r = oracleProseFidelity(orig(), broken);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("alpha");
    expect(r.detail).toContain("lead differs");
  });

  test("check() parity: dropping a group's Binds: line introduces a subject-no-binds finding the original never had", () => {
    const broken: SplitResult = { ...result, groupText: new Map(result.groupText) };
    broken.groupText.set("gamma", broken.groupText.get("gamma")!.replace("Binds: gamma-binds\n", ""));
    const r = oracleCheckParity(orig(), broken);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("only on the new layout");
  });

  test("next-free consistency: a README naming the wrong next-free number fails", () => {
    const broken: SplitResult = { ...result, readmeText: result.readmeText.replace("is 7.", "is 9.") };
    const r = oracleNextFree(orig(), broken);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("README says 9");
  });

  test("units() parity: a row's rule text edited inside its group's table fails, naming the step unit", () => {
    const broken: SplitResult = { ...result, groupText: new Map(result.groupText) };
    broken.groupText.set("alpha", broken.groupText.get("alpha")!.replace("Rule one", "Rule one, edited"));
    const r = oracleUnitsParity(orig(), broken);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("step:1");
  });

  // renderLedger round trip (the sixth oracle) rebuilds its Store from `result` alone and checks renderLedger
  // against that same store's own rows — there is no second, independent source of truth for it to diverge
  // from inside this script (unlike the other five, which compare against the original fixture or across two
  // independently-parsed texts). Breaking it would mean reproducing a bug in production renderLedger/parseSteps
  // itself, which packages/api/test/routes.test.ts already exercises directly; this script's test suite only
  // proves the sixth oracle agrees (PASS) on every fixture above, never injects a failure into it.
});

describe("migrate — mkdtempSync, no .git (the plain-unlink path; the git rm/commit path is the next piece's to exercise for real)", () => {
  test("writes decisions-taken/README.md + one file per group, removes the old pair, and what it wrote still passes every oracle", async () => {
    const root = mkdtempSync(join(tmpdir(), "split-record-migrate-"));
    const specs = join(root, "specs");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(specs, "decisions-taken-steps.md"), STEPS);
    writeFileSync(join(specs, "decisions-taken.md"), TAKEN);
    expect(existsSync(join(root, ".git"))).toBe(false);

    await migrate(root);

    expect(existsSync(join(specs, "decisions-taken-steps.md"))).toBe(false);
    expect(existsSync(join(specs, "decisions-taken.md"))).toBe(false);
    const recordDir = join(specs, "decisions-taken");
    expect(existsSync(join(recordDir, "README.md"))).toBe(true);
    expect(readdirSync(recordDir).sort()).toEqual(["README.md", "alpha.md", "beta.md", "gamma.md", "unfiled.md"].sort());
    expect(readFileSync(join(recordDir, "README.md"), "utf8")).toContain("**The next free number is 7.**");
    expect(readFileSync(join(recordDir, "gamma.md"), "utf8")).not.toMatch(/^\| \d/m);

    // "running dry-run again over the result": dryRun/plan read the pre-split flat pair migrate has just
    // removed (turning that pair into decisions-taken/ is this script's whole job, so there is no flat pair
    // left to re-run dry-run's own file-reading step over). What is checked here instead is the substance of
    // that request — that the bytes migrate actually wrote to disk still satisfy every one of the six oracles —
    // by reading them back and handing them to runOracles() exactly as planSplit() would have produced them.
    const readmeText = readFileSync(join(recordDir, "README.md"), "utf8");
    const groupText = new Map(
      readdirSync(recordDir)
        .filter((f) => f !== "README.md")
        .map((f): [string, string] => [f.slice(0, -".md".length), readFileSync(join(recordDir, f), "utf8")]),
    );
    const written: SplitResult = { ...planSplit(STEPS, TAKEN), readmeText, groupText };
    for (const { name, result: r } of runOracles(orig(), written)) expect([name, r.ok, r.detail]).toEqual([name, true, r.detail]);
  });
});
