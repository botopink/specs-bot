// The write endpoints (PLAN.md § 5.2): POST /api/write/<op> with a JSON body. Every write needs a party (a known
// token), is a dry run unless `apply: true`, and on success lands as one commit, swaps the model and publishes
// a `write` event for the machines (§ 5.6).
import {
  addSection,
  appendToSection,
  type ApplyResult,
  type Model,
  newDoc,
  type Plan,
  replaceSection,
  WriteError,
  type Writer,
} from "@specs-bot/core";
import { Hono } from "hono";
import type { Vars } from "./auth.ts";
import { type EventBus, now } from "./events.ts";

type Body = Record<string, unknown>;

const str = (b: Body, k: string, required = true): string => {
  const v = b[k];
  if (typeof v === "string") return v;
  if (v === undefined && !required) return "";
  throw new WriteError("invalid", `${k} is required (a string)`);
};

/** op → the plan it makes from the request body. */
const OPS: Record<string, (m: Model, b: Body) => Plan> = {
  "doc.replace": (m, b) => replaceSection(m, { ref: str(b, "ref"), anchor: str(b, "section"), text: str(b, "text"), etag: str(b, "etag") }),
  "doc.append": (m, b) => appendToSection(m, { ref: str(b, "ref"), anchor: str(b, "section"), text: str(b, "text") }),
  "doc.add-section": (m, b) =>
    addSection(m, {
      ref: str(b, "ref"),
      after: str(b, "after"),
      heading: str(b, "heading"),
      text: str(b, "text"),
      ...(typeof b.level === "number" ? { level: b.level } : {}),
    }),
  "doc.new": (m, b) => newDoc(m, { ref: str(b, "ref"), text: str(b, "text") }),
};

export interface WriteDeps {
  model: () => Model;
  /** Called with the model over the data after a write. */
  swap: (next: Model) => void;
  writer: Writer;
  bus: EventBus;
}

export function writeRoutes(deps: WriteDeps) {
  const api = new Hono<{ Variables: Vars }>();

  api.get("/write", (c) => c.json({ ops: Object.keys(OPS) }));

  api.post("/write/:op", async (c) => {
    const party = c.get("party");
    if (!party) return c.json({ error: "a write needs this machine's token", hint: "SPECS_BOT_TOKEN in the projects .env.local" }, 401);
    const op = c.req.param("op");
    const make = OPS[op];
    if (!make) return c.json({ error: `no write ${op}`, hint: `GET /api/write lists them: ${Object.keys(OPS).join(", ")}` }, 404);
    const body = (await c.req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") return c.json({ error: "the body is a JSON object" }, 400);

    try {
      const landed = Array.isArray(body.landed) ? body.landed.filter((x): x is string => typeof x === "string") : [];
      const plan = make(deps.model(), body);
      const r: ApplyResult = await deps.writer.apply(deps.model(), plan, party, { dryRun: body.apply !== true, landed });
      if (r.model && r.commit) {
        deps.swap(r.model);
        deps.bus.publish({ type: "write", op: r.op, party, commit: r.commit, refs: r.refs, summary: r.summary, at: now() });
      }
      const { model: _, ...answer } = r;
      return c.json({ applied: r.commit !== undefined, ...answer });
    } catch (e) {
      if (e instanceof WriteError) {
        return c.json({ error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}), ...(e.detail ?? {}) }, e.status as 409);
      }
      throw e;
    }
  });

  return api;
}
