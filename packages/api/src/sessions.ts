// Who is asking (PLAN.md § 3, layer 4): one party per session, one session per party (the maintainer,
// 2026-10-26). A session takes a party (`POST /api/session {party}`, the CLI's `specs-bot as <party>`) and gets an id
// it sends back as `X-Specs-Bot-Session`; while it holds the party, no other session can take it. The party is
// declared, not proven — the api lives on the private network. A session lets go with `DELETE /api/session`, or
// by being idle for the TTL. A token (`Authorization: Bearer`, SPECS_BOT_TOKENS) still names its party, and is
// refused while another session holds that party. The leases live in memory: after a restart the CLI takes its
// party again by itself.
import { PARTIES } from "@specs-bot/core";
import type { Hono, MiddlewareHandler } from "hono";

export type Vars = { party: string | undefined; session: string | undefined };

export interface Lease {
  id: string;
  party: string;
  /** Who holds it, as the session says ("host · .tasks/meta-m1"). */
  label: string;
  since: string;
  lastSeen: number;
  /** Held by an open websocket: it lasts as long as the connection, whatever the silence. */
  bound?: boolean;
}

export const SESSION_TTL_MS = 30 * 60 * 1000;

/** A party taken (`held`), or let go: released, silent past the TTL, its websocket closed, or left for another party. */
export type SessionChange = { lease: Omit<Lease, "lastSeen">; held: boolean };

export class Sessions {
  #byParty = new Map<string, Lease>();
  #byId = new Map<string, Lease>();
  #listeners = new Set<(change: SessionChange) => void>();

  constructor(readonly ttlMs = SESSION_TTL_MS, readonly now: () => number = Date.now) {}

  #alive(l: Lease | undefined): Lease | undefined {
    if (!l) return undefined;
    if (!l.bound && this.now() - l.lastSeen > this.ttlMs) {
      this.#drop(l);
      return undefined;
    }
    return l;
  }

  #drop(l: Lease): void {
    this.#byParty.delete(l.party);
    this.#byId.delete(l.id);
    this.#emit(l, false);
  }

  #emit(l: Lease, held: boolean): void {
    const { lastSeen: _, ...lease } = l;
    for (const fn of this.#listeners) {
      try {
        fn({ lease, held });
      } catch (e) {
        console.error(`specs-bot: a session listener failed: ${(e as Error).message}`);
      }
    }
  }

  /** Called whenever a party is taken or let go; answers the unsubscribe. */
  onChange(fn: (change: SessionChange) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Lets go of every lease silent past the TTL now (otherwise it is found the next time it is asked for). */
  sweep(): void {
    for (const l of [...this.#byParty.values()]) this.#alive(l);
  }

  /** Takes `party` for a new session, or says who holds it. A session that held another party lets it go. */
  take(party: string, label: string, current?: string, bound = false): { lease: Lease } | { held: Lease } | { unknown: true } {
    if (!(PARTIES as readonly string[]).includes(party)) return { unknown: true };
    const holder = this.#alive(this.#byParty.get(party));
    if (holder && holder.id === current) return { lease: holder };
    if (holder) return { held: holder };
    const mine = current ? this.#alive(this.#byId.get(current)) : undefined;
    if (mine) this.#drop(mine);
    const lease: Lease = { id: crypto.randomUUID().replace(/-/g, ""), party, label, since: new Date(this.now()).toISOString(), lastSeen: this.now(), ...(bound ? { bound } : {}) };
    this.#byParty.set(party, lease);
    this.#byId.set(lease.id, lease);
    this.#emit(lease, true);
    return { lease };
  }

  /** The lease of a session id, kept alive by the call. */
  touch(id: string): Lease | undefined {
    const l = this.#alive(this.#byId.get(id));
    if (l) l.lastSeen = this.now();
    return l;
  }

  release(id: string): boolean {
    const l = this.#byId.get(id);
    if (!l) return false;
    this.#drop(l);
    return true;
  }

  /** The party's holder, if a session holds it. */
  holder(party: string): Lease | undefined {
    return this.#alive(this.#byParty.get(party));
  }

  list(): Omit<Lease, "id" | "lastSeen">[] {
    this.sweep();
    return [...this.#byParty.values()].map(({ id: _, lastSeen: __, ...rest }) => rest);
  }
}

/** The party a request names: its session's, else its token's; or why it may not act. */
export function partyOf(
  sessions: Sessions,
  tokens: Map<string, string>,
  session: string | undefined,
  token: string | undefined,
): { party?: string; session?: string; error?: string; status?: 401 | 409 } {
  if (session) {
    const l = sessions.touch(session);
    return l ? { party: l.party, session: l.id } : { error: "unknown session", status: 401 };
  }
  if (token !== undefined) {
    const party = tokens.get(token);
    if (!party) return { error: "unknown token", status: 401 };
    const holder = sessions.holder(party);
    if (holder) return { error: `${party} is held by another session (${holder.label}, since ${holder.since})`, status: 409 };
    return { party };
  }
  return {};
}

const bearer = (h: string | undefined) => h?.match(/^Bearer\s+(\S+)$/i)?.[1];

export function identify(sessions: Sessions, tokens: Map<string, string>): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const named = partyOf(sessions, tokens, c.req.header("x-specs-bot-session"), bearer(c.req.header("authorization")));
    if (named.error) return c.json({ error: named.error, hint: "specs-bot as <party> takes a party for this session" }, named.status!);
    c.set("party", named.party);
    c.set("session", named.session);
    await next();
  };
}

/** POST /api/session {party, label} · DELETE /api/session · GET /api/sessions. */
export function mountSessions(api: Hono<{ Variables: Vars }>, sessions: Sessions): void {
  api.post("/session", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { party?: unknown; label?: unknown } | null;
    const party = typeof body?.party === "string" ? body.party : "";
    const label = typeof body?.label === "string" ? body.label.slice(0, 120) : "";
    const r = sessions.take(party, label, c.get("session"));
    if ("unknown" in r) return c.json({ error: `unknown party ${party || "(none)"}`, hint: `one of ${PARTIES.join(", ")}` }, 422);
    if ("held" in r) {
      return c.json(
        { error: `${party} is in use by another session`, holder: { label: r.held.label, since: r.held.since }, hint: "one session per party: specs-bot logout there, or wait 30 min of its silence" },
        409,
      );
    }
    return c.json({ session: r.lease.id, party: r.lease.party, since: r.lease.since, ttlMinutes: SESSION_TTL_MS / 60000 });
  });
  api.delete("/session", (c) => {
    const id = c.get("session");
    return id && sessions.release(id) ? c.json({ released: true }) : c.json({ released: false });
  });
  api.get("/sessions", (c) => c.json({ sessions: sessions.list() }));
}
