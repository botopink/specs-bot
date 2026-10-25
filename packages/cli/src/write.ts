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
}
