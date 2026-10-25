// conversation-chat — one file per message: `<dir>/<YYYYMMDD-HHMM>-<slug>-<id>.md`, a `---` head with
// from / to / purpose / subject / read / in-reply-to, then the body. `<dir>` is machine-1|2|3 or all.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Party = "maintainer" | "machine-1" | "machine-2" | "machine-3";
export type Purpose = "report" | "question" | "answer" | "digest" | "rule";

export interface ChatMessage {
  /** "machine-2/20261021-1144-b162-p1-rebased-m1-0024": the message's ref. */
  ref: string;
  dir: string;
  /** "m1-0024": the writer's short name and running number, never reused. */
  id: string;
  /** "2026-10-21T11:44", the writer's local time, as the file name says. */
  at: string;
  slug: string;
  from: string;
  to: string;
  purpose: string;
  subject: string;
  /** Who has read it: one entry for a message to one party, one per machine for a message to `all`. */
  read: Record<string, boolean>;
  /** The in-reply-to value as written: a path, a bare file name, or several, comma-separated. */
  inReplyTo?: string;
  /** The ids it answers. Replies link by id: 46 of 93 written paths are a bare name or a renamed file's old name. */
  replyTo: string[];
  body: string;
  lines: string[];
}

const NAME = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-([a-z0-9-]+)-([a-z0-9]+-\d{4})\.md$/;
const SHORT: Record<string, string> = { m1: "machine-1", m2: "machine-2", m3: "machine-3", mt: "maintainer" };

export function isMessageFile(name: string): boolean {
  return NAME.test(name);
}

export function parseMessage(path: string, text: string): ChatMessage {
  const [dir, file] = path.split("/") as [string, string];
  const n = file?.match(NAME);
  if (!dir || !n) throw new Error(`not a message path (<dir>/<YYYYMMDD-HHMM>-<slug>-<id>.md): ${path}`);
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`${path}: a message starts with a --- head`);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`${path}: the head is never closed`);

  const head = new Map<string, string>();
  for (const l of lines.slice(1, end)) {
    const i = l.indexOf(":");
    if (i > 0) head.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  const need = ["from", "to", "purpose", "subject", "read"].filter((k) => !head.has(k));
  if (need.length) throw new Error(`${path}: the head lacks ${need.join(", ")}`);

  const to = head.get("to")!;
  const inReplyTo = head.get("in-reply-to");
  return {
    ref: path.slice(0, -3),
    dir,
    id: n[7]!,
    at: `${n[1]}-${n[2]}-${n[3]}T${n[4]}:${n[5]}`,
    slug: n[6]!,
    from: head.get("from")!,
    to,
    purpose: head.get("purpose")!,
    subject: head.get("subject")!,
    read: parseRead(head.get("read")!, to),
    ...(inReplyTo ? { inReplyTo } : {}),
    replyTo: inReplyTo ? replyIds(inReplyTo) : [],
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""),
    lines,
  };
}

const ID_AT_END = /-([a-z][a-z0-9]*-\d{4})(?:\.md)?$/;

/** "machine-1/20261019-0333-x-m1-0004.md, 20261019-0400-y-m2-0001.md" → ["m1-0004", "m2-0001"]. */
export function replyIds(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0] ?? "")
    .map((p) => p.match(ID_AT_END)?.[1])
    .filter((id): id is string => id !== undefined);
}

/** "[x]" for one addressee; "m1 [x] · m2 [x] · m3 [ ]" for a message to all. */
export function parseRead(raw: string, to: string): Record<string, boolean> {
  const each = [...raw.matchAll(/\b(m\d|mt) \[( |x)\]/g)];
  if (each.length) return Object.fromEntries(each.map((m) => [SHORT[m[1]!] ?? m[1]!, m[2] === "x"]));
  const one = raw.match(/^\[( |x)\]/);
  if (!one) throw new Error(`read is "[ ]", "[x]" or "m1 [ ] · m2 [ ] · …": ${raw}`);
  return { [to]: one[1] === "x" };
}

export function loadChat(chatDir: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const d of readdirSync(chatDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === "scripts") continue;
    for (const f of readdirSync(join(chatDir, d.name)).sort()) {
      if (isMessageFile(f)) out.push(parseMessage(`${d.name}/${f}`, readFileSync(join(chatDir, d.name, f), "utf8")));
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** The messages a party has not read yet, oldest first. */
export function unreadBy(messages: ChatMessage[], party: string): ChatMessage[] {
  return messages.filter((m) => m.read[party] === false);
}

export function serializeMessage(m: ChatMessage): string {
  return m.lines.join("\n");
}
