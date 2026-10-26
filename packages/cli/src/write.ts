// The write commands (PLAN.md § 5.2): each is a dry run that prints the diff unless --apply is given.
// Long text comes from a file (`@path`) or standard input (`-`).
//
// WRITES is the one table of request bodies: the CLI's commands and the MCP server's tools (mcp.ts) both build
// the body of `POST /api/write/<op>` with it, from arguments named as the CLI's options are (commander's camelCase).
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { post } from "./client.ts";
import type { ClientConfig } from "./config.ts";
import { type Format, render } from "./output.ts";

/** `@path` reads a file, `-` reads standard input, anything else is the text itself. */
export async function textArg(value: string): Promise<string> {
  if (value === "-") return await new Response(Bun.stdin.stream()).text();
  if (value.startsWith("@")) {
    try {
      return readFileSync(value.slice(1), "utf8");
    } catch (e) {
      throw new Error(`cannot read ${value.slice(1)}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    }
  }
  return value.replace(/\\n/g, "\n");
}

export interface WriteAnswer {
  applied: boolean;
  op: string;
  refs: string[];
  summary: string;
  files: string[];
  diff: string;
  commit?: string;
}

export function printWrite(a: WriteAnswer, format: Format, applyHint = "add --apply to write it"): string {
  if (format === "json") return JSON.stringify(a, null, 2);
  const head = a.applied
    ? render({ applied: true, commit: a.commit, op: a.op, refs: a.refs }, format)
    : render({ applied: false, op: a.op, refs: a.refs, note: `dry run — nothing written; ${applyHint}` }, format);
  return `${head}\n---\n${a.diff}`;
}

// ── the request bodies ───────────────────────────────────────────────────────────────────────────────────

export type WriteArgs = Record<string, unknown>;

const s = (v: unknown) => (v === undefined ? undefined : String(v));
/** Only the keys whose value is set. */
const some = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The decision fields of a pending question, from --measured, --options, --recommendation and --blocks. */
export const FIELDS = [
  ["measured", "Measured"],
  ["options", "Options"],
  ["recommendation", "Recommendation"],
  ["blocks", "Blocks"],
] as const;
const fieldsOf = (a: WriteArgs) => some(Object.fromEntries(FIELDS.map(([arg, name]) => [name, s(a[arg])])));

/** command or tool name → the api's op and the body it sends (without `apply` and `landed`). */
export const WRITES: Record<string, { op: string; body: (a: WriteArgs) => Record<string, unknown> }> = {
  edit: { op: "doc.replace", body: (a) => ({ ref: a.ref, section: a.section, text: a.text, etag: a.etag }) },
  append: { op: "doc.append", body: (a) => ({ ref: a.ref, section: a.section, text: a.text }) },
  "add-section": {
    op: "doc.add-section",
    body: (a) => ({ ref: a.ref, after: a.after, heading: a.heading, text: a.text, ...(a.level !== undefined ? { level: Number(a.level) } : {}) }),
  },
  "new-doc": { op: "doc.new", body: (a) => ({ ref: a.ref, text: a.text }) },
  meta: { op: "doc.meta", body: (a) => ({ ref: a.ref, set: a.set ?? {}, unset: a.unset ?? [] }) },
  "pending-add": { op: "pending.add", body: (a) => ({ id: a.id, section: a.section, title: a.title, fields: fieldsOf(a) }) },
  "pending-edit": { op: "pending.edit", body: (a) => ({ id: a.id, etag: a.etag, ...some({ title: a.title }), fields: fieldsOf(a) }) },
  "pending-withdraw": { op: "pending.withdraw", body: (a) => ({ id: a.id, reason: a.reason }) },
  answer: {
    op: "answer",
    body: (a) => ({ id: a.id, rule: a.rule, binds: a.binds, ...some({ cell: a.cell, by: a.by, subject: a.subject, subjectText: a.subjectText }), process: a.process === true }),
  },
  supersede: { op: "supersede", body: (a) => ({ num: Number(a.n), by: Number(a.by), kind: a.kind }) },
  reviewed: { op: "review", body: (a) => ({ num: Number(a.n) }) },
  retire: {
    op: "retired.add",
    body: (a) => ({ area: a.area, retired: a.retired, replacedBy: a.replacedBy, decisions: a.decisions, ...some({ note: a.note }) }),
  },
  send: { op: "chat.send", body: (a) => ({ to: a.to, purpose: a.purpose, subject: a.subject, text: a.text, ...some({ inReplyTo: a.replyTo }) }) },
  "mark-read": { op: "chat.read", body: (a) => ({ id: a.id }) },
  claim: { op: "front.claim", body: (a) => ({ front: s(a.front) }) },
  release: { op: "front.release", body: (a) => ({ front: s(a.front) }) },
  assign: { op: "front.assign", body: (a) => ({ front: s(a.front), to: a.to }) },
};

/** The body of one write: the table's, plus whether to apply it and the code commits it goes with. */
export function writeBody(name: string, a: WriteArgs): { op: string; body: Record<string, unknown> } {
  const w = WRITES[name];
  if (!w) throw new Error(`no write ${name}`);
  return { op: w.op, body: { ...w.body(a), apply: a.apply === true, landed: Array.isArray(a.landed) ? a.landed : [] } };
}

// ── the commands ─────────────────────────────────────────────────────────────────────────────────────────

export function registerWrites(program: Command, config: () => ClientConfig) {
  /** Reads the `@file` / `-` arguments among `keys`, then posts the write named `name`. */
  const write = async (name: string, a: WriteArgs, texts: string[] = []) => {
    const resolved: WriteArgs = { ...a };
    for (const k of texts) if (typeof a[k] === "string") resolved[k] = await textArg(a[k]);
    const { op, body } = writeBody(name, resolved);
    const answer = (await post(config(), `write/${op}`, body)) as WriteAnswer;
    console.log(printWrite(answer, program.opts().format as Format));
  };
  const common = (cmd: Command) =>
    cmd
      .option("--apply", "write it (without it: a dry run that prints the diff)")
      .option("--landed <repo@sha...>", "the code commit(s) this write goes with; kept in the commit, never in the text");

  common(
    program
      .command("edit")
      .argument("<ref>", "the document")
      .requiredOption("-s, --section <anchor>", "the section to replace (its heading line included)")
      .requiredOption("-t, --text <text|@file|->", "the section's new text, starting with its heading")
      .requiredOption("-e, --etag <etag>", "the etag `specs-bot doc <ref> -s <anchor>` showed; a section changed since is refused")
      .description("replace one section of a document"),
  ).action((ref: string, o) => write("edit", { ...o, ref }, ["text"]));

  common(
    program
      .command("append")
      .argument("<ref>", "the document")
      .requiredOption("-s, --section <anchor>", "the section to add to (at its end)")
      .requiredOption("-t, --text <text|@file|->", "what to add; a list item joins the list the section ends with")
      .description("add text at the end of a section"),
  ).action((ref: string, o) => write("append", { ...o, ref }, ["text"]));

  common(
    program
      .command("add-section")
      .argument("<ref>", "the document")
      .requiredOption("--after <anchor>", "the section the new one follows")
      .requiredOption("--heading <text>", "the new section's heading, without the #")
      .requiredOption("-t, --text <text|@file|->", "the new section's body")
      .option("--level <n>", "2 to 6 (default: the level of --after)")
      .description("insert a new section into a document"),
  ).action((ref: string, o) => write("add-section", { ...o, ref }, ["text"]));

  common(
    program
      .command("new-doc")
      .argument("<ref>", "the new document's ref, in the current milestone, beside existing documents")
      .requiredOption("-t, --text <text|@file|->", "the document, starting with its title (# …)")
      .description("create a document"),
  ).action((ref: string, o) => write("new-doc", { ...o, ref }, ["text"]));

  common(
    program
      .command("meta")
      .argument("<ref>", "the document")
      .option("--set <key=value...>", "a key of its metadata block and its value (owner=machine-2, priority=high)")
      .option("--unset <key...>", "a key to remove")
      .description("set or remove keys of a document's metadata block (the YAML at its top)"),
  ).action(async (ref: string, o) => {
    const set: Record<string, string> = {};
    for (const kv of (o.set ?? []) as string[]) {
      const at = kv.indexOf("=");
      if (at < 1) throw new Error(`--set wants key=value: ${kv}`);
      set[kv.slice(0, at)] = kv.slice(at + 1).replace(/\\n/g, "\n");
    }
    await write("meta", { ...o, ref, set });
  });

  // ── fronts ──

  common(
    program
      .command("claim")
      .argument("<front>", "the front's folder (150-rakun) or its number")
      .description("take a free front to work it: this machine becomes its owner"),
  ).action(async (front: string, o) => write("claim", { ...o, front }));

  common(
    program
      .command("release")
      .argument("<front>", "the front's folder or its number")
      .description("let a front go: it has no owner again (its owner or the maintainer)"),
  ).action(async (front: string, o) => write("release", { ...o, front }));

  common(
    program
      .command("assign")
      .argument("<front>", "the front's folder or its number")
      .requiredOption("--to <machine>", "machine-1, machine-2 or machine-3")
      .description("give a front to a machine, whoever held it (the maintainer only)"),
  ).action(async (front: string, o) => write("assign", { ...o, front }));

  // ── decisions ──────────────────────────────────────────────────────────────────────────────────────────

  const fieldOptions = (cmd: Command) =>
    cmd
      .option("--measured <text|@file|->", "what was observed, re-runnable")
      .option("--options <text|@file|->", "(a) … (b) …")
      .option("--recommendation <text|@file|->", "the most restrictive reading (decision 67)")
      .option("--blocks <text|@file|->", "what waits on the answer");
  const fieldTexts = FIELDS.map(([arg]) => arg);

  common(
    fieldOptions(
      program
        .command("pending-add")
        .requiredOption("--id <id>", "a new id, never used (e.g. 956-b)")
        .requiredOption("--section <words>", "the pending section: its heading or words only it contains (\"machine 1\")")
        .requiredOption("--title <text>", "the question in one line")
        .description("open a question in decisions-pending.md (Measured, Options, Recommendation and Blocks all required)"),
    ),
  ).action((o) => write("pending-add", o, fieldTexts));

  common(
    fieldOptions(
      program
        .command("pending-edit")
        .argument("<id>", "the open question")
        .requiredOption("-e, --etag <etag>", "the etag `specs-bot pending <id>` showed")
        .option("--title <text>", "a new title")
        .description("revise an open question's title or fields; the others are kept"),
    ),
  ).action((id: string, o) => write("pending-edit", { ...o, id }, fieldTexts));

  common(
    program
      .command("pending-withdraw")
      .argument("<id>", "the open question")
      .requiredOption("--reason <text>", "why it leaves without an answer (kept in the commit)")
      .description("remove a question nobody will answer"),
  ).action((id: string, o) => write("pending-withdraw", { ...o, id }));

  common(
    program
      .command("answer")
      .argument("<id>", "the pending id it answers (it leaves the page), or a new id for a ruling no question asked")
      .requiredOption("--rule <text|@file|->", "the rule as decided, one row (**Bold lead.** then the text)")
      .requiredOption("--binds <text>", "the fronts and steps it binds (`machine-1/144` B-162 · …)")
      .option("--cell <slug>", "the conformance cell's slug (decision 647)")
      .option("--process", "a row that fixes no program behaviour")
      .option("--by <who>", "who decided, as the Id cell says it (default: the maintainer, or the coordinator †)")
      .option("--subject <slug>", "the subject of decisions-taken.md the row joins (its Steps and Binds)")
      .option("--subject-text <text|@file|->", "the sentence the subject gains")
      .description("record a decision: the next free number, in the record; a machine's decision is marked for review"),
  ).action((id: string, o) => write("answer", { ...o, id }, ["rule", "subjectText"]));

  common(
    program
      .command("supersede")
      .argument("<n>", "the row that stops being in force")
      .requiredOption("--by <m>", "the later row in force")
      .requiredOption("--kind <kind>", "overtaken | replaced | reversed")
      .description("mark a row overtaken, replaced or reversed by a later one (its text is kept)"),
  ).action((n: string, o) => write("supersede", { ...o, n }));

  common(program.command("reviewed").argument("<n>", "the step in the To review table").description("mark a delegated decision reviewed (the maintainer)")).action(
    (n: string, o) => write("reviewed", { ...o, n }),
  );

  common(
    program
      .command("retire")
      .requiredOption("--area <words>", "the retired.md area (\"language spellings\", \"process\" …)")
      .requiredOption("--retired <text>", "the form retired")
      .requiredOption("--replaced-by <text>", "what replaces it")
      .requiredOption("--decisions <text>", "the rows it comes from (\"606 (1), 609\")")
      .option("--note <text>", "since when, or a note")
      .description("add a retired form"),
  ).action((o) => write("retire", o));

  // ── conversation ───────────────────────────────────────────────────────────────────────────────────────

  common(
    program
      .command("send")
      .requiredOption("--to <party>", "maintainer | machine-1 | machine-2 | machine-3 | all")
      .requiredOption("--purpose <p>", "report | question | answer | digest | rule")
      .requiredOption("--subject <text>", "one line saying what the message is for")
      .requiredOption("-t, --text <text|@file|->", "the message (a report: Done, Running, Next, Blocking)")
      .option("--reply-to <id>", "the message it answers (m1-0024)")
      .description("write a message in the conversation; the machines hear it at once (specs-bot watch)"),
  ).action((o) => write("send", o, ["text"]));

  common(program.command("mark-read").argument("<id>", "a message to this machine").description("mark a message read")).action((id: string, o) =>
    write("mark-read", { ...o, id }),
  );
}
