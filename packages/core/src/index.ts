// Parsers, writers, index, rules and git access over the specs-data repository (PLAN.md § 2).
// The api package is the only one that opens the data; cli talks to the api over HTTP.

export const SPECS_DIR = "specs";

export * from "./md/table.ts";
export * from "./decisions/steps.ts";
export * from "./decisions/pending.ts";
export * from "./decisions/taken.ts";
export * from "./decisions/retired.ts";
export * from "./docs/doc.ts";
export * from "./docs/load.ts";
export * from "./chat/chat.ts";
export * from "./store.ts";
export * from "./check.ts";
export * from "./search.ts";
export * from "./model.ts";
export * from "./write/plan.ts";
export * from "./write/diff.ts";
export * from "./write/rules.ts";
export * from "./write/doc.ts";
export * from "./write/apply.ts";
export * from "./write/decisions.ts";
export * from "./write/chat.ts";
export * from "./write/git.ts";
export * from "./gaps.ts";
export * from "./docs/meta.ts";
export * from "./write/front.ts";
