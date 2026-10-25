// `specs-bot export <set> --to <dir>`: the spec files a script outside the bot still reads as files (botopink's
// gate scripts), written under <dir> in the specs/ layout. Only the sets the api offers; never arbitrary paths.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { get } from "./client.ts";
import type { ClientConfig } from "./config.ts";

export function registerExport(program: Command, config: () => ClientConfig) {
  program
    .command("export")
    .argument("<set>", "ledger (decisions-split.py) | language-gaps (language-gap-markers)")
    .requiredOption("--to <dir>", "where to write them, laid out as specs/")
    .description("write a set of spec files for a script that reads files; prints the directory")
    .action(async (set: string, o: { to: string }) => {
      const answer = (await get(config(), `export/${encodeURIComponent(set)}`)) as { files: Record<string, string> };
      const root = resolve(o.to);
      for (const [rel, text] of Object.entries(answer.files)) {
        if (rel.startsWith("/") || rel.split("/").includes("..")) throw new Error(`refused path from the api: ${rel}`);
        const file = join(root, rel);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
      }
      console.log(root);
    });
}
