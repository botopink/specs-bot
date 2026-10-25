// A write is planned before anything touches the disk: the files it changes, each with the exact text it was
// planned against (`before`, null for a new file) and the text it leaves (`after`). The api applies a plan
// atomically and refuses it if a file moved in between (PLAN.md § 5).
import { createHash } from "node:crypto";

export interface Change {
  /** Relative to the data repository: "specs/1.0.12-beta/status.md", "conversation-chat/machine-2/….md". */
  path: string;
  before: string | null;
  after: string;
}

export interface Plan {
  /** "doc.replace", "pending.add", "answer", … */
  op: string;
  /** What changed, as the api names it: "1.0.12-beta/status#open", "step 957", "pending 956-b", "message m2-0039". */
  refs: string[];
  /** The commit's subject line, in the repository's style. */
  message: string;
  /** One line for people: what the write does. */
  summary: string;
  changes: Change[];
  /** A message the write sends: the api publishes it as a `chat` event to the machines. */
  chat?: { id: string; from: string; to: string; purpose: string; subject: string };
}

export class WriteError extends Error {
  constructor(
    /** "conflict", "not-found", "invalid", "frozen", "forbidden", "rule" */
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }

  get status(): number {
    return { conflict: 409, "not-found": 404, forbidden: 403, frozen: 423 }[this.code] ?? 422;
  }
}

/** A short content hash: what a reader got, to send back with an edit so a stale edit is refused. */
export function etagOf(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}
