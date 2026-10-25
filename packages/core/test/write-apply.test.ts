import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appendToSection, loadModel, type Model, newDoc, WriteError, Writer } from "../src/index.ts";

const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md": "**The next free number is 2.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 | A rule | x |  |\n",
  "specs/decisions-pending.md": "the next free\nnumber, which is **2**.\n\n## Machine 1\n\nNone open.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — l\n\n**L.**\n\nText.\n\nSteps: 1\nBinds: x\n",
  "specs/retired.md": "# R\n",
  "specs/1.0.12-beta/status.md": "# Status\n\n## Done\n\n- [x] a\n",
};

async function sh(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
  return out.trim();
}

let root: string;
let model: Model;
let writer: Writer;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "specs-bot-write-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  await sh(root, "init", "-q", "-b", "main");
  await sh(root, "-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  await sh(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  await sh(root, "config", "user.name", "specs-bot");
  await sh(root, "config", "user.email", "specs-bot@localhost");
  model = loadModel(root);
  writer = new Writer(root);
});

const append = (text: string) => appendToSection(model, { ref: "1.0.12-beta/status", anchor: "done", text });

describe("Writer", () => {
  test("a write lands as one commit authored by the party, with its trailers", async () => {
    const r = await writer.apply(model, append("- [x] b"), "machine-2", { landed: ["rakun@abc1234"] });
    expect(readFileSync(join(root, "specs/1.0.12-beta/status.md"), "utf8")).toBe("# Status\n\n## Done\n\n- [x] a\n- [x] b\n");
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(await sh(root, "log", "-1", "--format=%an|%s")).toBe("machine-2|spec(1.0.12-beta): 1.0.12-beta/status § Done: added");
    expect(await sh(root, "log", "-1", "--format=%b")).toBe("Op: doc.append\nParty: machine-2\nLanded: rakun@abc1234");
    expect(await sh(root, "status", "--porcelain")).toBe("");
    expect(r.model!.docByRef.get("1.0.12-beta/status")!.lines).toContain("- [x] b");
  });

  test("a dry run returns the diff and writes nothing", async () => {
    const r = await writer.apply(model, append("- [x] b"), "machine-2", { dryRun: true });
    expect(r.diff).toContain("+- [x] b");
    expect(r.commit).toBeUndefined();
    expect(readFileSync(join(root, "specs/1.0.12-beta/status.md"), "utf8")).toBe(FILES["specs/1.0.12-beta/status.md"]!);
  });

  test("a file edited since the model was read refuses the write", async () => {
    writeFileSync(join(root, "specs/1.0.12-beta/status.md"), "# Status\n\nby hand\n");
    const e = await writer.apply(model, append("- [x] b"), "machine-2").catch((x) => x);
    expect(e).toBeInstanceOf(WriteError);
    expect((e as WriteError).code).toBe("conflict");
  });

  test("a commit hash in the text is refused before anything is written", async () => {
    const e = (await writer.apply(model, append("- [x] landed 1a2b3c4d"), "machine-2").catch((x) => x)) as WriteError;
    expect([e.code, e.message]).toEqual(["rule", "the text breaks commit-hash"]);
    expect(await sh(root, "rev-list", "--count", "HEAD")).toBe("1");
  });

  test("a write that brings a check error is undone", async () => {
    // A document whose link-free text is fine, but the plan also breaks the next free number in the record.
    const plan = newDoc(model, { ref: "1.0.12-beta/notes", text: "# Notes" });
    plan.changes.push({
      path: "specs/decisions-taken-steps.md",
      before: FILES["specs/decisions-taken-steps.md"]!,
      after: FILES["specs/decisions-taken-steps.md"]!.replace("is 2.", "is 9."),
    });
    const e = (await writer.apply(model, plan, "machine-2").catch((x) => x)) as WriteError;
    expect(e.message).toBe("the write would break next-free-mismatch");
    expect(readFileSync(join(root, "specs/decisions-taken-steps.md"), "utf8")).toBe(FILES["specs/decisions-taken-steps.md"]!);
    expect(await sh(root, "status", "--porcelain")).toBe("");
  });

  test("writes arriving together run one after another", async () => {
    const a = writer.apply(model, append("- [x] b"), "machine-1");
    // Planned against the same model: the second must see the first's change and refuse.
    const b = writer.apply(model, append("- [x] c"), "machine-2").catch((x) => x);
    await a;
    expect(((await b) as WriteError).code).toBe("conflict");
  });
});
