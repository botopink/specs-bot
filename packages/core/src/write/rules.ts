// The rules an added spec line must keep — botopink's land-check.py and scratch-refs.py, held at write time
// instead of at landing (PLAN.md § 5.5).
import { addedLines } from "./diff.ts";
import type { Plan } from "./plan.ts";

export interface TextFinding {
  rule: string;
  path: string;
  text: string;
  match: string;
}

/** land-check's commit-hash: 7–40 hex digits with at least one digit and one letter. */
const HASH = /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;

/** scratch-refs.py's patterns: a task folder, a scratch path, a task branch, a worktree by name. */
const SCRATCH: [string, RegExp][] = [
  ["tasks-path", /\.tasks\/(?!<)[A-Za-z0-9._-]+/],
  ["tmp-path", /(?<![A-Za-z0-9_.`])\/tmp\/(?!`)|scratchpad/],
  ["task-branch", /(?<![A-Za-z0-9_/.-])front\/(?!<|step\b)[a-z0-9][a-z0-9._-]*[a-z0-9](?=[`\s,;:)]|$)/],
  ["worktree", /\bworktree `(?!<|-)[^`]+`/],
];

/** The findings over the lines a plan adds under specs/. A commit hash belongs in the commit (--landed), never the text. */
export function textRules(plan: Plan): TextFinding[] {
  const out: TextFinding[] = [];
  for (const c of plan.changes) {
    if (!c.path.startsWith("specs/")) continue;
    for (const line of addedLines(c.before, c.after)) {
      const h = line.match(HASH);
      if (h) out.push({ rule: "commit-hash", path: c.path, text: line, match: h[0] });
      for (const [rule, rx] of SCRATCH) {
        const m = line.match(rx);
        if (m) out.push({ rule, path: c.path, text: line, match: m[0] });
      }
    }
  }
  return out;
}
