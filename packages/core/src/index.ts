// Parsers, writers, index, rules and git access over the specs-data repository (PLAN.md § 2).
// The api package is the only one that opens the data; cli talks to the api over HTTP.

export const SPECS_DIR = "specs";

export * from "./md/table.ts";
export * from "./decisions/steps.ts";
