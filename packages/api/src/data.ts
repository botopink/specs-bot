// Read-only facts about the specs-data repository. Writes arrive in phase 3.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SPECS_DIR } from "@specs-bot/core";

export interface DataState {
  ok: boolean;
  branch?: string;
  head?: string;
  error?: string;
}

async function git(dataPath: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dataPath, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(err.trim() || `git ${args[0]} exited ${code}`);
  return out.trim();
}

export async function dataState(dataPath: string): Promise<DataState> {
  if (!existsSync(join(dataPath, SPECS_DIR))) {
    return { ok: false, error: `no ${SPECS_DIR}/ under the data path` };
  }
  try {
    const [branch, head] = await Promise.all([
      git(dataPath, "rev-parse", "--abbrev-ref", "HEAD"),
      git(dataPath, "rev-parse", "--short", "HEAD"),
    ]);
    return { ok: true, branch, head };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
