// The write endpoints (PLAN.md § 5.2): POST /api/write/<op> with a JSON body. Every write needs a party (a known
// token), is a dry run unless `apply: true`, and on success lands as one commit, swaps the model and publishes
// a `write` event for the machines (§ 5.6).
import {
  addSection,
  answer,
  appendToSection,
  chatRead,
  chatSend,
  markReviewed,
  pendingAdd,
  pendingEdit,
  pendingWithdraw,
  retiredAdd,
  supersede,
  type ApplyResult,
  type Model,
  newDoc,
  setMeta,
  type Plan,
  replaceSection,
  WriteError,
  type Writer,
} from "@specs-bot/core";
import { Hono } from "hono";
import type { Vars } from "./sessions.ts";
import { type EventBus, now } from "./events.ts";

type Body = Record<string, unknown>;

const str = (b: Body, k: string, required = true): string => {
  const v = b[k];
  if (typeof v === "string") return v;
  if (v === undefined && !required) return "";
  throw new WriteError("invalid", `${k} is required (a string)`);
};

const num = (b: Body, k: string): number => {
  const v = typeof b[k] === "string" ? Number(b[k]) : b[k];
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  throw new WriteError("invalid", `${k} is required (a decision number)`);
};

const fieldsOf = (b: Body): Record<string, string> => {
  const f = b.fields;
  if (f === undefined) return {};
  if (typeof f !== "object" || f === null || Object.values(f).some((v) => typeof v !== "string")) {
    throw new WriteError("invalid", "fields is an object of strings: { Measured, Options, Recommendation, Blocks }");
  }
  return f as Record<string, string>;
};

const opt = (b: Body, k: string) => (typeof b[k] === "string" ? { [k]: b[k] as string } : {});

/** op → the plan it makes from the request body and the party writing. */
const OPS: Record<string, (m: Model, b: Body, party: string) => Plan> = {
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
  "doc.meta": (m, b) =>
    setMeta(m, {
      ref: str(b, "ref"),
      ...(b.set && typeof b.set === "object" && !Array.isArray(b.set) ? { set: Object.fromEntries(Object.entries(b.set as Record<string, unknown>).map(([k, v]) => [k, String(v)])) } : {}),
      ...(Array.isArray(b.unset) ? { unset: (b.unset as unknown[]).map(String) } : {}),
    }),
  "pending.add": (m, b) => pendingAdd(m, { id: str(b, "id"), section: str(b, "section"), title: str(b, "title"), fields: fieldsOf(b) }),
  "pending.edit": (m, b) => pendingEdit(m, { id: str(b, "id"), etag: str(b, "etag"), ...opt(b, "title"), fields: fieldsOf(b) }),
  "pending.withdraw": (m, b) => pendingWithdraw(m, { id: str(b, "id"), reason: str(b, "reason") }),
  answer: (m, b, party) =>
    answer(
      m,
      {
        id: str(b, "id"),
        rule: str(b, "rule"),
        binds: str(b, "binds"),
        ...opt(b, "cell"),
        ...opt(b, "by"),
        ...opt(b, "subject"),
        ...opt(b, "subjectText"),
        process: b.process === true,
      },
      party,
    ),
  supersede: (m, b) => {
    const kind = str(b, "kind");
    if (kind !== "overtaken" && kind !== "replaced" && kind !== "reversed") throw new WriteError("invalid", "kind is overtaken, replaced or reversed");
    return supersede(m, { num: num(b, "num"), by: num(b, "by"), kind });
  },
  review: (m, b, party) => markReviewed(m, { num: num(b, "num") }, party),
  "retired.add": (m, b) =>
    retiredAdd(m, { area: str(b, "area"), retired: str(b, "retired"), replacedBy: str(b, "replacedBy"), decisions: str(b, "decisions"), ...opt(b, "note") }),
  "chat.send": (m, b, party) =>
    chatSend(m, { to: str(b, "to"), purpose: str(b, "purpose"), subject: str(b, "subject"), text: str(b, "text"), ...opt(b, "inReplyTo") }, party),
  "chat.read": (m, b, party) => chatRead(m, { id: str(b, "id") }, party),
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
    if (!party) return c.json({ error: "a write needs a party", hint: "specs-bot as <party> (or SPECS_BOT_AS=<party> in the projects .env.local)" }, 401);
    const op = c.req.param("op");
    const make = OPS[op];
    if (!make) return c.json({ error: `no write ${op}`, hint: `GET /api/write lists them: ${Object.keys(OPS).join(", ")}` }, 404);
    const body = (await c.req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== "object") return c.json({ error: "the body is a JSON object" }, 400);

    try {
      const landed = Array.isArray(body.landed) ? body.landed.filter((x): x is string => typeof x === "string") : [];
      const plan = make(deps.model(), body, party);
      const r: ApplyResult = await deps.writer.apply(deps.model(), plan, party, { dryRun: body.apply !== true, landed });
      if (r.model && r.commit) {
        deps.swap(r.model);
        deps.bus.publish({ type: "write", op: r.op, party, commit: r.commit, refs: r.refs, summary: r.summary, at: now() });
        if (r.chat) deps.bus.publish({ type: "chat", ...r.chat, at: now() });
      }
      const { model: _, ...result } = r;
      return c.json({ applied: r.commit !== undefined, ...result });
    } catch (e) {
      if (e instanceof WriteError) {
        return c.json({ error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}), ...(e.detail ?? {}) }, e.status as 409);
      }
      throw e;
    }
  });

  return api;
}
