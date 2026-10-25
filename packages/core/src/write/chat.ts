// Conversation writes (PLAN.md § 5.2): a message is a new file, `<dir>/<YYYYMMDD-HHMM>-<slug>-<id>.md`, under the
// conventions of conversation-chat's README; reading one turns the reader's mark to [x].
import type { ChatMessage } from "../chat/chat.ts";
import type { Model } from "../model.ts";
import { type Plan, WriteError } from "./plan.ts";

export const PARTIES = ["maintainer", "machine-1", "machine-2", "machine-3"] as const;
export const PURPOSES = ["report", "question", "answer", "digest", "rule"] as const;

const SHORT: Record<string, string> = { maintainer: "mt", "machine-1": "m1", "machine-2": "m2", "machine-3": "m3" };

/** Where a message is filed: to all → all/; else the machine's conversation (machine-N/) it is to or from. */
function dirOf(from: string, to: string): string {
  if (to === "all") return "all";
  if (to.startsWith("machine-")) return to;
  if (from.startsWith("machine-")) return from;
  throw new WriteError("invalid", "the maintainer writes to a machine or to all");
}

/** Three to six lowercase words of the subject, joined with hyphens. */
export function slugOf(subject: string): string {
  const words = subject
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const slug = words.slice(0, 6).join("-");
  if (!slug) throw new WriteError("invalid", "the subject has no words to name the file by");
  return slug;
}

function stamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
}

/** The writer's next running number: one sequence per writer, never reused. */
function nextId(messages: ChatMessage[], party: string): string {
  const short = SHORT[party]!;
  const used = messages.filter((m) => m.id.startsWith(`${short}-`)).map((m) => Number(m.id.slice(short.length + 1)));
  return `${short}-${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

export interface SendInput {
  to: string;
  purpose: string;
  subject: string;
  text: string;
  /** The id (m1-0024) or file of the message it answers. */
  inReplyTo?: string;
  at?: Date;
}

export function chatSend(model: Model, input: SendInput, party: string): Plan {
  if (!SHORT[party]) throw new WriteError("forbidden", `${party} does not write in the conversation`);
  const to = input.to.trim();
  if (to !== "all" && !(PARTIES as readonly string[]).includes(to)) throw new WriteError("invalid", `to is one of ${[...PARTIES, "all"].join(", ")}`);
  if (to === party) throw new WriteError("invalid", "a message goes to another party");
  if (!(PURPOSES as readonly string[]).includes(input.purpose)) throw new WriteError("invalid", `purpose is one of ${PURPOSES.join(", ")}`);
  const subject = input.subject.replace(/\s+/g, " ").trim();
  if (!subject) throw new WriteError("invalid", "the subject is one line saying what the message is for");
  const body = input.text.replace(/\s+$/, "");
  if (!body) throw new WriteError("invalid", "the message is empty");

  let reply = "";
  if (input.inReplyTo) {
    const key = input.inReplyTo.trim().replace(/\.md$/, "");
    const target = model.messageById.get(key) ?? model.chat.find((m) => m.ref === key || m.ref.endsWith(`/${key}`));
    if (!target) throw new WriteError("not-found", `no message ${input.inReplyTo} to answer`, "specs-bot chat lists them");
    reply = `${target.ref}.md`;
  }

  const id = nextId(model.chat, party);
  const dir = dirOf(party, to);
  const ref = `${dir}/${stamp(input.at ?? new Date())}-${slugOf(subject)}-${id}`;
  // To all: one mark per other machine (the maintainer's too when a machine writes to all).
  const read =
    to === "all"
      ? Object.entries(SHORT)
          .filter(([p]) => p !== party && (p !== "maintainer" || party !== "maintainer"))
          .filter(([p]) => p !== "maintainer" || party.startsWith("machine-"))
          .map(([, s]) => `${s} [ ]`)
          .join(" · ")
      : "[ ]";
  const text = ["---", `from: ${party}`, `to: ${to}`, `purpose: ${input.purpose}`, `subject: ${subject}`, `read: ${read}`, `in-reply-to:${reply ? ` ${reply}` : ""}`, "---", "", body, ""].join("\n");
  return {
    op: "chat.send",
    refs: [`message ${id}`],
    message: `chat: ${id} ${party} → ${to}: ${subject}`,
    summary: `${party} → ${to} (${input.purpose}): ${subject}`,
    changes: [{ path: `conversation-chat/${ref}.md`, before: null, after: text }],
    chat: { id, from: party, to, purpose: input.purpose, subject },
  };
}

export function chatRead(model: Model, input: { id: string }, party: string): Plan {
  const m = model.messageById.get(input.id);
  if (!m) throw new WriteError("not-found", `message ${input.id} not found`);
  if (!(party in m.read)) throw new WriteError("forbidden", `${input.id} is not addressed to ${party}`);
  if (m.read[party]) throw new WriteError("invalid", `${party} has already read ${input.id}`);
  const short = SHORT[party]!;
  const end = m.lines.indexOf("---", 1);
  const lines = [...m.lines];
  const at = lines.findIndex((l, i) => i < end && l.startsWith("read:"));
  lines[at] = m.to === "all" ? lines[at]!.replace(`${short} [ ]`, `${short} [x]`) : lines[at]!.replace("[ ]", "[x]");
  return {
    op: "chat.read",
    refs: [`message ${m.id}`],
    message: `chat: ${m.id} read by ${party}`,
    summary: `${party} read ${m.id}`,
    changes: [{ path: `conversation-chat/${m.ref}.md`, before: m.lines.join("\n"), after: lines.join("\n") }],
  };
}
