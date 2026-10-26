// `specs-bot watch` and `specs-bot online` (PLAN.md § 5.6): the api's events as they happen, over its websocket.
// `watch --once` lets an agent wait for the next message to it; `--timeout` bounds the wait.
import { whoHeaders } from "./client.ts";
import { encode } from "@toon-format/toon";
import type { Command } from "commander";
import { get } from "./client.ts";
import type { ClientConfig } from "./config.ts";
import { type Format, render } from "./output.ts";

export type EventType = "write" | "chat" | "presence" | "doing" | "session";
/** doing and session come only when named: without --type the api sends the first three. */
const TYPES: EventType[] = ["write", "chat", "presence", "doing", "session"];

export interface WatchOptions {
  types?: EventType[];
  /** Chat to this party (and to all) only. */
  to?: string;
  once: boolean;
  timeoutS?: number;
  format: Format;
}

/** Exit codes: 0 an event came (--once) or the stream ended by request; 1 refused; 3 the host dropped (--once); 5 timeout. */
export const EXIT = { ok: 0, refused: 1, dropped: 3, timeout: 5 } as const;

/** http://host:7165/api → ws://host:7165/api/ws?types=…&to=… (https → wss). */
export function wsUrl(api: string, query: { types?: EventType[]; to?: string }): string {
  const url = new URL(`${api.replace(/\/+$/, "")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (query.types?.length) url.searchParams.set("types", query.types.join(","));
  if (query.to) url.searchParams.set("to", query.to);
  return url.toString();
}

export function parseTypes(raw: string | undefined): EventType[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(",").map((t) => t.trim());
  const bad = list.filter((t) => !TYPES.includes(t as EventType));
  if (bad.length) throw new Error(`unknown event type ${bad.join(", ")} (${TYPES.join(", ")})`);
  return list as EventType[];
}

/** One event: a line of JSON, a TOON block followed by a blank line, or one line of text. */
export function renderEvent(event: Record<string, unknown>, format: Format): string {
  if (format === "json") return JSON.stringify(event);
  if (format === "toon") return `${encode(event)}\n`;
  const at = typeof event.at === "string" ? event.at.replace("T", " ").replace(/\.\d+Z$/, "Z") : "";
  switch (event.type) {
    case "write":
      return `${at} write ${event.op} by ${event.party} · ${event.commit} · ${(event.refs as string[]).join(", ")} — ${event.summary}`;
    case "chat":
      return `${at} chat ${event.id} ${event.from} → ${event.to} (${event.purpose}) — ${event.subject}`;
    case "presence":
      return `${at} ${event.party} ${event.online ? "online" : "offline"}`;
    case "doing":
      return `${at} ${event.party} ${event.text === null ? "done" : `doing: ${event.text}${event.front ? ` [${event.front}]` : ""}`}`;
    case "session":
      return `${at} ${event.party} ${event.held ? "taken" : "let go"} · ${event.label}`;
    default:
      return `${at} ${JSON.stringify(event)}`;
  }
}

const CONTROL = new Set(["hello", "subscribed", "pong", "error"]);

export async function watch(config: ClientConfig, opts: WatchOptions, out: (s: string) => void = console.log): Promise<number> {
  const url = wsUrl(config.api, opts);
  const headers = await whoHeaders(config);
  let backoff = 1000;

  return new Promise<number>((resolve) => {
    let done = false;
    let socket: WebSocket | undefined;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      socket?.close();
      resolve(code);
    };
    if (opts.timeoutS !== undefined) {
      setTimeout(() => {
        console.error(`✗ no event in ${opts.timeoutS} s`);
        finish(EXIT.timeout);
      }, opts.timeoutS * 1000).unref?.();
    }

    const open = () => {
      // Bun's WebSocket takes headers; the token stays out of the URL.
      const ws = new WebSocket(url, { headers } as unknown as string[]);
      socket = ws;
      ws.onmessage = (e) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (CONTROL.has(String(event.type))) {
          if (event.type === "hello") {
            backoff = 1000;
            console.error(`· watching ${config.api} as ${event.party ?? "nobody"}`);
          } else if (event.type === "error") console.error(`✗ ${event.error}`);
          return;
        }
        out(renderEvent(event, opts.format));
        if (opts.once) finish(EXIT.ok);
      };
      ws.onclose = (e) => {
        if (done) return;
        if (e.code === 4401) {
          console.error("✗ the api refused the party this machine names\n  check SPECS_BOT_AS (a known party) or the token in the projects .env.local");
          finish(EXIT.refused);
          return;
        }
        if (opts.once) {
          console.error(`✗ the connection to ${config.api} dropped`);
          finish(EXIT.dropped);
          return;
        }
        console.error(`· disconnected; trying again in ${backoff / 1000} s`);
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
    };
    open();
  });
}

/** Adds `watch` and `online` to the program. */
export function registerRealtime(program: Command, config: () => ClientConfig): void {
  const format = () => program.opts().format as Format;

  program
    .command("watch")
    .description("events as they happen: writes, chat, machines coming and going (the api's websocket)")
    .option("-t, --type <types>", "write,chat,presence,doing,session (comma-separated; the first three by default)")
    .option("--to <party>", "chat to this party (and to all) only; this machine's own party by default")
    .option("--all", "chat to anyone, not only to this machine")
    .option("--once", "stop after the first event (exit 0) — wait for the next message to this machine")
    .option("--timeout <seconds>", "give up after this long (exit 5)")
    .action(async (o) => {
      const c = config();
      const types = parseTypes(o.type);
      let to: string | undefined = o.all ? undefined : o.to;
      if (!to && !o.all && (!types || types.includes("chat"))) {
        to = ((await get(c, "whoami")) as { party: string | null }).party ?? undefined;
      }
      const timeout = o.timeout === undefined ? undefined : Number(o.timeout);
      if (timeout !== undefined && !(timeout > 0)) throw new Error(`--timeout is a number of seconds: ${o.timeout}`);
      const code = await watch(c, {
        once: Boolean(o.once),
        format: format(),
        ...(types ? { types } : {}),
        ...(to ? { to } : {}),
        ...(timeout !== undefined ? { timeoutS: timeout } : {}),
      });
      process.exit(code);
    });

  program
    .command("online")
    .description("the machines connected to the api's websocket now")
    .action(async () => {
      console.log(render(await get(config(), "presence"), format()));
    });
}
