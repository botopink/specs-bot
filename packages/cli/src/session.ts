// This folder's session with the api (sessions.ts in the api): one party per session, one session per party. The
// session id is kept per project folder (the checkout, or a task worktree with its own .env) under
// ~/.local/state/specs-bot/sessions/, so two folders are two sessions and the same folder is always the same one.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ClientConfig } from "./config.ts";

export interface Saved {
  api: string;
  party: string;
  session: string;
  since: string;
}

function file(config: ClientConfig): string {
  const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const key = createHash("sha256").update(`${config.api}\n${config.root}`).digest("hex").slice(0, 16);
  return join(state, "specs-bot", "sessions", `${key}.json`);
}

export function savedSession(config: ClientConfig): Saved | undefined {
  try {
    const s = JSON.parse(readFileSync(file(config), "utf8")) as Saved;
    return s.api === config.api ? s : undefined;
  } catch {
    return undefined;
  }
}

export function saveSession(config: ClientConfig, s: Saved): void {
  const f = file(config);
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  writeFileSync(f, `${JSON.stringify(s, null, 1)}\n`, { mode: 0o600 });
}

export function forgetSession(config: ClientConfig): void {
  const f = file(config);
  if (existsSync(f)) rmSync(f);
}

/** What the api is told about who holds a party: the machine and the folder. */
export function sessionLabel(config: ClientConfig): string {
  const home = homedir();
  const where = config.root.startsWith(home) ? `~/${relative(home, config.root)}` : config.root;
  return `${hostname()} · ${where}`;
}
