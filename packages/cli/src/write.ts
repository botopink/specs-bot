// The write commands (PLAN.md § 5.2): each is a dry run that prints the diff unless --apply is given.
// Long text comes from a file (`@path`) or standard input (`-`).
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

interface WriteAnswer {
  applied: boolean;
  op: string;
  refs: string[];
  summary: string;
  files: string[];
  diff: string;
  commit?: string;
}

export function printWrite(a: WriteAnswer, format: Format): string {
  if (format === "json") return JSON.stringify(a, null, 2);
  const head = a.applied
    ? render({ applied: true, commit: a.commit, op: a.op, refs: a.refs }, format)
    : render({ applied: false, op: a.op, refs: a.refs, note: "dry run — nothing written; add --apply to write it" }, format);
  return `${head}\n---\n${a.diff}`;
}

export function registerWrites(program: Command, config: () => ClientConfig) {
  const write = async (op: string, body: Record<string, unknown>, o: { apply?: boolean; landed?: string[] }) => {
    const answer = (await post(config(), `write/${op}`, { ...body, apply: o.apply === true, landed: o.landed ?? [] })) as WriteAnswer;
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
  ).action(async (ref: string, o) => write("doc.replace", { ref, section: o.section, text: await textArg(o.text), etag: o.etag }, o));

  common(
    program
      .command("append")
      .argument("<ref>", "the document")
      .requiredOption("-s, --section <anchor>", "the section to add to (at its end)")
      .requiredOption("-t, --text <text|@file|->", "what to add; a list item joins the list the section ends with")
      .description("add text at the end of a section"),
  ).action(async (ref: string, o) => write("doc.append", { ref, section: o.section, text: await textArg(o.text) }, o));

  common(
    program
      .command("add-section")
      .argument("<ref>", "the document")
      .requiredOption("--after <anchor>", "the section the new one follows")
      .requiredOption("--heading <text>", "the new section's heading, without the #")
      .requiredOption("-t, --text <text|@file|->", "the new section's body")
      .option("--level <n>", "2 to 6 (default: the level of --after)")
      .description("insert a new section into a document"),
  ).action(async (ref: string, o) =>
    write("doc.add-section", { ref, after: o.after, heading: o.heading, text: await textArg(o.text), ...(o.level ? { level: Number(o.level) } : {}) }, o),
  );

  common(
    program
      .command("new-doc")
      .argument("<ref>", "the new document's ref, in the current milestone, beside existing documents")
      .requiredOption("-t, --text <text|@file|->", "the document, starting with its title (# …)")
      .description("create a document"),
  ).action(async (ref: string, o) => write("doc.new", { ref, text: await textArg(o.text) }, o));

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
    await write("doc.meta", { ref, set, unset: o.unset ?? [] }, o);
  });

  // ── fronts ──

  common(
    program
      .command("claim")
      .argument("<front>", "the front's folder (150-rakun) or its number")
      .description("take a free front to work it: this machine becomes its owner"),
  ).action(async (front: string, o) => write("front.claim", { front }, o));

  common(
    program
      .command("release")
      .argument("<front>", "the front's folder or its number")
      .description("let a front go: it has no owner again (its owner or the maintainer)"),
  ).action(async (front: string, o) => write("front.release", { front }, o));

  common(
    program
      .command("assign")
      .argument("<front>", "the front's folder or its number")
      .requiredOption("--to <machine>", "machine-1, machine-2 or machine-3")
      .description("give a front to a machine, whoever held it (the maintainer only)"),
  ).action(async (front: string, o) => write("front.assign", { front, to: o.to }, o));

  // ── decisions ──────────────────────────────────────────────────────────────────────────────────────────

  const fieldOptions = (cmd: Command) =>
    cmd
      .option("--measured <text|@file|->", "what was observed, re-runnable")
      .option("--options <text|@file|->", "(a) … (b) …")
      .option("--recommendation <text|@file|->", "the most restrictive reading (decision 67)")
      .option("--blocks <text|@file|->", "what waits on the answer");
  const fields = async (o: Record<string, string | undefined>) => {
    const out: Record<string, string> = {};
    for (const [opt, name] of [["measured", "Measured"], ["options", "Options"], ["recommendation", "Recommendation"], ["blocks", "Blocks"]] as const) {
      if (o[opt] !== undefined) out[name] = await textArg(o[opt]!);
    }
    return out;
  };

  common(
    fieldOptions(
      program
        .command("pending-add")
        .requiredOption("--id <id>", "a new id, never used (e.g. 956-b)")
        .requiredOption("--section <words>", "the pending section: its heading or words only it contains (\"machine 1\")")
        .requiredOption("--title <text>", "the question in one line")
        .description("open a question in decisions-pending.md (Measured, Options, Recommendation and Blocks all required)"),
    ),
  ).action(async (o) => write("pending.add", { id: o.id, section: o.section, title: o.title, fields: await fields(o) }, o));

  common(
    fieldOptions(
      program
        .command("pending-edit")
        .argument("<id>", "the open question")
        .requiredOption("-e, --etag <etag>", "the etag `specs-bot pending <id>` showed")
        .option("--title <text>", "a new title")
        .description("revise an open question's title or fields; the others are kept"),
    ),
  ).action(async (id: string, o) => write("pending.edit", { id, etag: o.etag, ...(o.title ? { title: o.title } : {}), fields: await fields(o) }, o));

  common(
    program
      .command("pending-withdraw")
      .argument("<id>", "the open question")
      .requiredOption("--reason <text>", "why it leaves without an answer (kept in the commit)")
      .description("remove a question nobody will answer"),
  ).action((id: string, o) => write("pending.withdraw", { id, reason: o.reason }, o));

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
  ).action(async (id: string, o) =>
    write(
      "answer",
      {
        id,
        rule: await textArg(o.rule),
        binds: o.binds,
        ...(o.cell ? { cell: o.cell } : {}),
        ...(o.by ? { by: o.by } : {}),
        ...(o.subject ? { subject: o.subject } : {}),
        ...(o.subjectText ? { subjectText: await textArg(o.subjectText) } : {}),
        process: o.process === true,
      },
      o,
    ),
  );

  common(
    program
      .command("supersede")
      .argument("<n>", "the row that stops being in force")
      .requiredOption("--by <m>", "the later row in force")
      .requiredOption("--kind <kind>", "overtaken | replaced | reversed")
      .description("mark a row overtaken, replaced or reversed by a later one (its text is kept)"),
  ).action((n: string, o) => write("supersede", { num: Number(n), by: Number(o.by), kind: o.kind }, o));

  common(program.command("reviewed").argument("<n>", "the step in the To review table").description("mark a delegated decision reviewed (the maintainer)")).action(
    (n: string, o) => write("review", { num: Number(n) }, o),
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
  ).action((o) => write("retired.add", { area: o.area, retired: o.retired, replacedBy: o.replacedBy, decisions: o.decisions, ...(o.note ? { note: o.note } : {}) }, o));

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
  ).action(async (o) =>
    write("chat.send", { to: o.to, purpose: o.purpose, subject: o.subject, text: await textArg(o.text), ...(o.replyTo ? { inReplyTo: o.replyTo } : {}) }, o),
  );

  common(program.command("mark-read").argument("<id>", "a message to this machine").description("mark a message read")).action((id: string, o) =>
    write("chat.read", { id }, o),
  );
}
