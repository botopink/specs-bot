#!/usr/bin/env bun
// `specs-bot` — the agents' door to the specs (PLAN.md § 5.1). A thin client: every answer comes from the api.
import { Command, Option } from "commander";
import { ApiError, get, type Query, releaseParty, takeParty } from "./client.ts";
import { savedSession } from "./session.ts";
import { type ClientConfig, loadClientConfig } from "./config.ts";
import { type Format, render } from "./output.ts";
import { registerRealtime } from "./watch.ts";
import { registerExport } from "./export.ts";
import { registerWrites } from "./write.ts";

const program = new Command()
  .name("specs-bot")
  .description("Read the botopink specs through the specs-bot api. Output is TOON unless --format says otherwise.")
  .version("0.0.1")
  .addOption(new Option("-f, --format <format>", "output format").choices(["toon", "json", "text"]).default("toon"))
  .option("--api <url>", "the api's URL (overrides SPECS_BOT_API_URL)")
  .option("--as <party>", "act as this party (overrides SPECS_BOT_AS); one party per session, one session per party");

function config(): ClientConfig {
  const c = loadClientConfig(process.cwd(), process.env, program.opts().as as string | undefined);
  const api = program.opts().api as string | undefined;
  return api ? { ...c, api: api.replace(/\/+$/, "") } : c;
}

/** One GET, printed in the chosen format. */
function read(path: string | (() => string), query: () => Query = () => ({})) {
  return async () => {
    const value = await get(config(), typeof path === "string" ? path : path(), query());
    console.log(render(value, program.opts().format as Format));
  };
}

const enc = encodeURIComponent;

program.command("whoami").description("check the connection and the party this machine's token names").action(async () => {
  const c = config();
  const [who, health] = await Promise.all([get(c, "whoami"), get(c, "health")]);
  console.log(render({ api: c.api, config: c.source, ...(c.as ? { as: c.as } : {}), ...(who as object), health }, program.opts().format as Format));
});

program
  .command("as")
  .argument("<party>", "maintainer, machine-1, machine-2 or machine-3")
  .description("take a party for this folder's session; refused while another session holds it")
  .action(async (party: string) => {
    const r = await takeParty(config(), party);
    console.log(render({ party: r.party, since: r.since, note: "this folder acts as it until specs-bot logout or 30 min of silence" }, program.opts().format as Format));
  });

program
  .command("logout")
  .description("let go of this folder's party, so another session can take it")
  .action(async () => {
    const c = config();
    const held = savedSession(c);
    const released = await releaseParty(c);
    console.log(render({ released, ...(held ? { party: held.party } : {}) }, program.opts().format as Format));
  });

program.command("sessions").description("which session holds which party now").action(read("sessions"));

program.command("overview").description("counts of the current milestone").action(read("overview"));
program.command("next").description("the next free decision number, and whether the files agree").action(read("next"));

program
  .command("search")
  .argument("<words...>", "what to look for; a code like for-await-one-source is matched word for word first")
  .description("full-text search over steps, pending questions, subjects, retired forms, doc sections and messages")
  .option("-k, --kind <kinds>", "step,pending,subject,retired,section,message (comma-separated)")
  .option("--version <v>", "only this milestone's sections")
  .option("--machine <m>", "only this machine's sections")
  .option("--front <n>", "only this front's sections")
  .option("--frozen", "include closed milestones' sections")
  .option("-n, --limit <n>", "how many hits", "10")
  .action(async (words: string[], o) => {
    await read("search", () => ({ q: words.join(" "), kind: o.kind, version: o.version, machine: o.machine, front: o.front, frozen: o.frozen, limit: o.limit }))();
  });

program
  .command("step")
  .argument("<n>", "the decision number")
  .description("one decision row whole: rule, binds, cell, who supersedes it, subjects and retired forms citing it")
  .action((n: string) => read(`steps/${enc(n)}`)());

program
  .command("steps")
  .description("list decision rows")
  .option("--section <s>", "the ## section of the record")
  .option("--status <s>", "in-force | overtaken | replaced | reversed | superseded")
  .option("-q, --query <text>", "rows whose id, rule or binds contain it")
  .option("-n, --limit <n>", "how many", "50")
  .option("--offset <n>", "skip this many", "0")
  .action((o) => read("steps", () => ({ section: o.section, status: o.status, q: o.query, limit: o.limit, offset: o.offset }))());

program
  .command("pending")
  .argument("[id]", "one open question, whole")
  .description("the open questions by section, or one of them")
  .option("--section <s>", "sections whose heading contains it")
  .action((id: string | undefined, o) => (id ? read(`pending/${enc(id)}`)() : read("pending", () => ({ section: o.section }))()));

program
  .command("review")
  .description("the To review table")
  .option("--open", "only the items not yet reviewed")
  .action((o) => read("review", () => ({ open: o.open }))());

program
  .command("subject")
  .argument("[slug]", "one subject of decisions-taken, whole")
  .description("the subjects of the rules in force, or one of them")
  .action((slug?: string) => (slug ? read(`subjects/${enc(slug)}`)() : read("subjects")()));

program
  .command("retired")
  .argument("[words...]", "retired forms whose text contains them")
  .description("forms the language, std, libraries or process retired, and what replaced each")
  .action((words: string[]) => read("retired", () => ({ q: words.length ? words.join(" ") : undefined }))());

program
  .command("fronts")
  .description("the fronts of a milestone")
  .option("--version <v>", "the milestone (the current one by default)")
  .option("--machine <m>", "only this machine's")
  .action((o) => read("fronts", () => ({ version: o.version, machine: o.machine }))());

program
  .command("front")
  .argument("<num>", "the front's number")
  .description("one front: its folders' documents and the in-force rows that bind it")
  .option("--version <v>", "the milestone (the current one by default)")
  .action((num: string, o) => read(`fronts/${enc(num)}`, () => ({ version: o.version }))());

program
  .command("doc")
  .argument("<ref>", "a document ref, e.g. 150-rakun/README or milestone/status (a folder means its README)")
  .description("a document: whole, its outline, or one section")
  .option("-s, --section <anchor>", "only this section (anchors from --outline)")
  .option("-o, --outline", "only the headings, with their anchors and sizes")
  .action((ref: string, o) =>
    read(`docs/${ref.split("/").map(enc).join("/")}`, () => ({ section: o.section, outline: o.outline }))(),
  );

program
  .command("chat")
  .argument("[id]", "one message, whole")
  .description("the conversation between the machines and the maintainer")
  .option("--to <party>", "messages to this party (machine-1, machine-2, maintainer, …)")
  .option("--unread <party>", "messages this party has not read")
  .option("-n, --limit <n>", "how many, newest first", "20")
  .action((id: string | undefined, o) => (id ? read(`chat/${enc(id)}`)() : read("chat", () => ({ to: o.to, unread: o.unread, limit: o.limit }))()));

program
  .command("check")
  .description("the conventions' rules over the whole repository")
  .option("--severity <s>", "error | warning")
  .action((o) => read("check", () => ({ severity: o.severity }))());

// Real-time: watch, online (PLAN.md § 5.6).
registerRealtime(program, config);

// Writes: edit, append, add-section, new-doc (PLAN.md § 5.2).
registerWrites(program, config);

// For the scripts that still read spec files (botopink/projects' gate): export <set> --to <dir>.
registerExport(program, config);

program.parseAsync().catch((e: unknown) => {
  if (e instanceof ApiError) {
    console.error(`✗ ${e.message}${e.hint ? `\n  ${e.hint}` : ""}`);
    const body = (e.body ?? {}) as { etag?: string; findings?: { rule?: string; code?: string; match?: string; text?: string; message?: string }[] };
    if (body.etag) console.error(`  current etag: ${body.etag}`);
    for (const f of body.findings ?? []) console.error(`  ${f.rule ?? f.code}: ${f.match ?? f.message ?? ""}${f.text ? ` — ${f.text.slice(0, 120)}` : ""}`);
    // 3 unreachable · 4 not found · 6 conflict (read again, redo) · 1 anything else
    process.exit(e.status === 0 ? 3 : e.status === 404 ? 4 : e.status === 409 ? 6 : 1);
  }
  console.error(`✗ ${(e as Error).message}`);
  process.exit(2);
});
