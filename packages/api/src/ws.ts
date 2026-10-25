// Real-time events between the machines (PLAN.md § 5.6): `/api/ws` relays every bus event to the connected
// clients whose filter matches, and tells who is online. `GET /api/presence` answers the same over HTTP.
import type { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { type EventBus, now, type SpecEvent } from "./events.ts";

const bun = createBunWebSocket();

type BunSocket = Parameters<typeof bun.websocket.open>[0];

/** Bun's websocket handler, with protocol pongs reaching the client that answered (heartbeat). Pass it to `Bun.serve({ websocket })`. */
export const websocket = {
  ...bun.websocket,
  pong(ws: BunSocket) {
    (ws.data.events as { onPong?: () => void }).onPong?.();
  },
};

export interface Filter {
  /** Only these event types; every type when absent. */
  types?: Set<SpecEvent["type"]>;
  /** For chat events: only messages to this party (or to all). */
  to?: string;
}

const TYPES: SpecEvent["type"][] = ["write", "chat", "presence"];

export function parseFilter(types: unknown, to: unknown): Filter {
  const list = (Array.isArray(types) ? types : typeof types === "string" ? types.split(",") : [])
    .map((t) => String(t).trim())
    .filter((t): t is SpecEvent["type"] => TYPES.includes(t as SpecEvent["type"]));
  return {
    ...(list.length ? { types: new Set(list) } : {}),
    ...(typeof to === "string" && to ? { to } : {}),
  };
}

export function matches(filter: Filter, event: SpecEvent): boolean {
  if (filter.types && !filter.types.has(event.type)) return false;
  if (filter.to && event.type === "chat") return event.to === filter.to || event.to === "all";
  return true;
}

interface Client {
  ws: WSContext;
  party: string | null;
  filter: Filter;
  alive: boolean;
}

export interface Presence {
  party: string;
  since: string;
  connections: number;
}

export interface HubOptions {
  /** How often dead sockets are found and dropped (a client that missed the previous ping). Default 30 s. */
  heartbeatMs?: number;
}

/** The connected clients of one app, fed by its bus. */
export class Hub {
  readonly #clients = new Set<Client>();
  readonly #online = new Map<string, Presence>();
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly bus: EventBus,
    readonly heartbeatMs = 30_000,
  ) {
    bus.subscribe((event) => {
      const text = JSON.stringify(event);
      for (const c of this.#clients) if (matches(c.filter, event)) c.ws.send(text);
    });
  }

  presence(): Presence[] {
    return [...this.#online.values()].sort((a, b) => a.party.localeCompare(b.party));
  }

  get size(): number {
    return this.#clients.size;
  }

  open(client: Client): void {
    this.#clients.add(client);
    if (client.party) {
      const p = this.#online.get(client.party);
      if (p) p.connections++;
      else {
        const at = now();
        this.#online.set(client.party, { party: client.party, since: at, connections: 1 });
        this.bus.publish({ type: "presence", party: client.party, online: true, at });
      }
    }
    this.#timer ??= setInterval(() => this.#beat(), this.heartbeatMs);
  }

  close(client: Client): void {
    if (!this.#clients.delete(client)) return;
    if (client.party) {
      const p = this.#online.get(client.party);
      if (p && --p.connections === 0) {
        this.#online.delete(client.party);
        this.bus.publish({ type: "presence", party: client.party, online: false, at: now() });
      }
    }
    if (this.#clients.size === 0 && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** A client that did not answer the last ping is dropped; the others are pinged again. */
  #beat(): void {
    for (const c of [...this.#clients]) {
      if (!c.alive) {
        c.ws.close(4408, "no pong");
        this.close(c);
        continue;
      }
      c.alive = false;
      (c.ws.raw as { ping(): void } | undefined)?.ping();
    }
  }
}

/**
 * Mounts `/api/ws` and `/api/presence` on the app. Registered before the api's own routes, so an unknown token
 * closes the socket with 4401 instead of failing the handshake.
 */
export function mountRealtime(app: Hono, tokens: Map<string, string>, bus: EventBus, opts: HubOptions = {}): Hub {
  const hub = new Hub(bus, opts.heartbeatMs);

  app.get("/api/presence", (c) => c.json({ online: hub.presence(), listeners: hub.size }));

  app.get(
    "/api/ws",
    bun.upgradeWebSocket((c) => {
      const header = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
      const token = header ?? c.req.query("token");
      const known = token === undefined || tokens.has(token);
      const client: Omit<Client, "ws"> = {
        party: token !== undefined ? (tokens.get(token) ?? null) : null,
        filter: parseFilter(c.req.query("types"), c.req.query("to")),
        alive: true,
      };
      let me: Client | undefined;
      return {
        onOpen(_e, ws) {
          if (!known) {
            ws.close(4401, "unknown token");
            return;
          }
          me = { ...client, ws };
          // The greeting first, then the arrival: a client's first message is always its hello.
          ws.send(JSON.stringify({ type: "hello", party: me.party, at: now() }));
          hub.open(me);
        },
        onMessage(e, ws) {
          if (!me) return;
          me.alive = true;
          let msg: { type?: string; types?: unknown; to?: unknown };
          try {
            msg = JSON.parse(String(e.data));
          } catch {
            ws.send(JSON.stringify({ type: "error", error: "a message is JSON" }));
            return;
          }
          if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", at: now() }));
          else if (msg.type === "subscribe") {
            me.filter = parseFilter(msg.types, msg.to);
            ws.send(JSON.stringify({ type: "subscribed", types: [...(me.filter.types ?? TYPES)], to: me.filter.to ?? null }));
          } else ws.send(JSON.stringify({ type: "error", error: `unknown message type ${msg.type}` }));
        },
        onPong() {
          if (me) me.alive = true;
        },
        onClose() {
          if (me) hub.close(me);
        },
      };
    }),
  );
  return hub;
}
