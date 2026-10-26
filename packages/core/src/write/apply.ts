// Applying a plan to the data repository (PLAN.md § 5): one write at a time, refused when a file moved since it
// was planned, written atomically, checked, and committed as one commit authored by the party.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { check, type Finding } from "../check.ts";
import { type Model, loadModel } from "../model.ts";
import { unifiedDiff } from "./diff.ts";
import { git } from "./git.ts";
import { type Plan, WriteError } from "./plan.ts";
import { textRules } from "./rules.ts";

export interface ApplyOptions {
  /** Plan and diff only; nothing is written. */
  dryRun?: boolean;
  /** "<repo>@<sha>" the write goes with (the code that landed it); carried in the commit, never the text. */
  landed?: string[];
}

export interface ApplyResult {
  op: string;
  refs: string[];
  summary: string;
  files: string[];
  diff: string;
  /** Absent on a dry run. */
  commit?: string;
  /** The model over the data as it is after the write (absent on a dry run). */
  model?: Model;
  chat?: Plan["chat"];
}

const key = (f: Finding) => `${f.code}\u0000${f.about}\u0000${f.message}`;

export class Writer {
  #queue: Promise<unknown> = Promise.resolve();
  /** The model over the data as the last write left it: the next one's search index is updated from its. */
  #last?: Model;

  constructor(readonly dataPath: string) {}

  /** Writes run one after another, in the order they arrive. */
  apply(model: Model, plan: Plan, party: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
    const run = this.#queue.then(() => this.#apply(model, plan, party, opts));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #apply(model: Model, plan: Plan, party: string, opts: ApplyOptions): Promise<ApplyResult> {
    const broken = textRules(plan);
    if (broken.length) {
      throw new WriteError("rule", `the text breaks ${broken.map((f) => f.rule).join(", ")}`, "a commit hash goes in --landed, never in the spec's text; no scratch paths or task branches", {
        findings: broken,
      });
    }

    // A file that moved since the plan was made (an edit by hand, another write) refuses the whole plan.
    for (const c of plan.changes) {
      const abs = join(this.dataPath, c.path);
      const now = existsSync(abs) ? readFileSync(abs, "utf8") : null;
      if (now !== c.before) {
        throw new WriteError("conflict", `${c.path} changed since it was read`, "read it again and redo the write", { path: c.path });
      }
    }

    const files = plan.changes.map((c) => c.path);
    const diff = plan.changes.map((c) => unifiedDiff(c.path, c.before, c.after)).filter(Boolean).join("\n");
    const base = { op: plan.op, refs: plan.refs, summary: plan.summary, files, diff, ...(plan.chat ? { chat: plan.chat } : {}) };
    if (opts.dryRun) return base;

    const written: { abs: string; before: string | null }[] = [];
    const undo = () => {
      for (const w of written.reverse()) {
        if (w.before === null) unlinkSync(w.abs);
        else writeFileSync(w.abs, w.before);
      }
    };
    try {
      for (const c of plan.changes) {
        const abs = join(this.dataPath, c.path);
        mkdirSync(dirname(abs), { recursive: true });
        const tmp = `${abs}.specs-bot-${process.pid}.tmp`;
        writeFileSync(tmp, c.after);
        renameSync(tmp, abs);
        written.push({ abs, before: c.before });
      }

      // The write may not bring an error the data did not have.
      // A plan made on an older model still lands on the data the last write left.
      const after = loadModel(this.dataPath, { model: this.#last ?? model, paths: files });
      const had = new Set(check(model).filter((f) => f.severity === "error").map(key));
      const fresh = check(after).filter((f) => f.severity === "error" && !had.has(key(f)));
      if (fresh.length) {
        throw new WriteError("rule", `the write would break ${fresh.map((f) => f.code).join(", ")}`, undefined, { findings: fresh });
      }

      await git(this.dataPath, ["add", "--", ...files]);
      const trailers = [`Op: ${plan.op}`, `Party: ${party}`, ...(opts.landed ?? []).map((l) => `Landed: ${l}`)];
      await git(this.dataPath, ["commit", "--quiet", "-m", plan.message, "-m", trailers.join("\n"), "--", ...files], {
        GIT_AUTHOR_NAME: party,
        GIT_AUTHOR_EMAIL: `${party}@specs-bot`,
      });
      const commit = await git(this.dataPath, ["rev-parse", "--short", "HEAD"]);
      this.#last = after;
      return { ...base, commit, model: after };
    } catch (e) {
      undo();
      // Unstage what was added, so the index matches HEAD again.
      await git(this.dataPath, ["reset", "--quiet", "--", ...files]).catch(() => undefined);
      throw e;
    }
  }
}
