// What happened, for whoever listens: every write publishes here, and the websocket (/api/ws) relays it to the
// machines (PLAN.md § 5.6), and the site's /now page follows them. In-process only; a listener that throws never
// stops the others.

export type SpecEvent =
  /** A write landed: one commit in specs-data. `refs` names what changed as the api names it (doc refs, "step 957", "pending 956-b"). */
  | { type: "write"; op: string; party: string; commit: string; refs: string[]; summary: string; at: string }
  /** A message was sent to a party (or to all). */
  | { type: "chat"; id: string; from: string; to: string; purpose: string; subject: string; at: string }
  /** A machine connected to or left the websocket. */
  | { type: "presence"; party: string; online: boolean; at: string }
  /** What a party says it is doing now (now.ts); `text` null: it cleared it, or its session ended. */
  | { type: "doing"; party: string; text: string | null; front: string | null; at: string }
  /** A session took a party (`held`), or let it go: released, expired, or its websocket closed. */
  | { type: "session"; party: string; held: boolean; label: string; since: string; at: string };

export type Listener = (event: SpecEvent) => void;

export class EventBus {
  #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  publish(event: SpecEvent): void {
    for (const l of this.#listeners) {
      try {
        l(event);
      } catch (e) {
        console.error(`specs-bot: an event listener failed: ${(e as Error).message}`);
      }
    }
  }

  get size(): number {
    return this.#listeners.size;
  }
}

export const now = () => new Date().toISOString();
