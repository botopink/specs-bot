// The read endpoints (PLAN.md § 5.1). Domain objects only: refs and ids, never a file path.
import { check, etagOf, type Kind, MILESTONE_DIR, type Model, pendingEtag, sectionEtag, sectionText, summarize } from "@specs-bot/core";
import { Hono } from "hono";
import type { Vars } from "./sessions.ts";

const KINDS: Kind[] = ["step", "pending", "subject", "retired", "section", "message"];

const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isNaN(n) ? fallback : n;
};

/** `current` answers the model in force: a write swaps it, and every request reads the one in force then. */
export function readRoutes(current: () => Model) {
  // Every handler reads `model.…` at request time, so a swap is seen by the next request.
  const model = new Proxy({} as Model, { get: (_, key) => Reflect.get(current(), key) });
  const api = new Hono<{ Variables: Vars }>();
  const notFound = (what: string, hint?: string) => ({ error: `${what} not found`, ...(hint ? { hint } : {}) });

  api.get("/whoami", (c) => c.json({ party: c.get("party") ?? null }));

  api.get("/overview", (c) => {
    const byStatus = { "in-force": 0, overtaken: 0, replaced: 0, reversed: 0 };
    for (const r of model.steps.rows) byStatus[r.status]++;
    return c.json({
      milestone: model.tree.current,
      versions: model.tree.versions,
      steps: { total: model.steps.rows.length, ...byStatus },
      pending: model.entries.length,
      review: { open: model.pending.review.filter((r) => !r.reviewed).length, total: model.pending.review.length },
      subjects: model.taken.subjects.length,
      retired: model.retired.rows.length,
      docs: model.tree.docs.length,
      messages: model.chat.length,
      nextFree: model.nextFree,
    });
  });

  api.get("/next", (c) => {
    const s = model.statedNextFree;
    return c.json({ nextFree: model.nextFree, stated: s, agree: s.steps === model.nextFree && s.pending === model.nextFree });
  });

  api.get("/search", (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ error: "q is required", hint: "GET /api/search?q=<words>" }, 400);
    const kinds = c.req.query("kind")?.split(",").filter((k): k is Kind => KINDS.includes(k as Kind));
    const front = c.req.query("front");
    const owner = c.req.query("owner") ?? c.req.query("machine");
    const version = c.req.query("version");
    const hits = model.index.search(q, {
      limit: Math.min(int(c.req.query("limit"), 10), 50),
      frozen: c.req.query("frozen") === "1" || c.req.query("frozen") === "true",
      ...(kinds?.length ? { kinds } : {}),
      ...(version ? { version } : {}),
      ...(owner ? { owner } : {}),
      ...(front ? { front: int(front, -1) } : {}),
    });
    return c.json({ q, hits });
  });

  api.get("/steps", (c) => {
    const section = c.req.query("section");
    const status = c.req.query("status");
    const q = c.req.query("q")?.toLowerCase();
    const limit = Math.min(int(c.req.query("limit"), 50), 500);
    const offset = int(c.req.query("offset"), 0);
    const rows = model.steps.rows
      .filter((r) => !section || r.section === section)
      .filter((r) => !status || (status === "superseded" ? r.status !== "in-force" : r.status === status))
      .filter((r) => !q || `${r.id} ${r.rule} ${r.binds}`.toLowerCase().includes(q))
      .sort((a, b) => a.num - b.num);
    return c.json({
      total: rows.length,
      offset,
      steps: rows.slice(offset, offset + limit).map((r) => ({
        num: r.num,
        id: r.id,
        status: r.status,
        ...(r.supersededBy !== undefined ? { supersededBy: r.supersededBy } : {}),
        section: r.section,
        rule: r.rule.length > 200 ? `${r.rule.slice(0, 200)}…` : r.rule,
      })),
    });
  });

  api.get("/steps/:n", (c) => {
    const n = int(c.req.param("n"), -1);
    const r = model.stepByNum.get(n);
    if (!r) {
      const hint = n > 0 && n < model.nextFree ? `${n} is a number never used` : `the next free number is ${model.nextFree}`;
      return c.json(notFound(`step ${c.req.param("n")}`, hint), 404);
    }
    return c.json({
      num: r.num,
      id: r.id,
      status: r.status,
      ...(r.supersededBy !== undefined ? { supersededBy: r.supersededBy } : {}),
      supersedes: (model.supersedes.get(r.num) ?? []).map((s) => ({ num: s.num, status: s.status })),
      section: r.section,
      process: r.process,
      delegated: r.delegated,
      rule: r.rule,
      binds: r.binds,
      cell: r.cell,
      subjects: (model.subjectsByStep.get(r.num) ?? []).map((s) => s.slug),
      retired: (model.retiredByStep.get(r.num) ?? []).map((x) => ({ retired: x.retired, replacedBy: x.replacedBy })),
    });
  });

  api.get("/pending", (c) => {
    const section = c.req.query("section");
    return c.json({
      sections: model.pending.sections
        .filter((s) => !section || s.heading.toLowerCase().includes(section.toLowerCase()))
        .filter((s) => s.entries.length)
        .map((s) => ({ section: s.heading, entries: s.entries.map((e) => ({ id: e.id, title: e.title })) })),
    });
  });

  api.get("/pending/:id", (c) => {
    const id = c.req.param("id");
    const e = model.entries.find((x) => x.id === id);
    if (!e) {
      const step = model.answeredBy.get(id);
      return c.json(notFound(`pending ${id}`, step ? `answered by step ${step}` : "GET /api/pending lists the open ones"), 404);
    }
    // The etag goes back with `specs-bot pending-edit`, so a stale edit is refused.
    return c.json({ id: e.id, title: e.title, section: e.section, etag: pendingEtag(e), fields: e.fields });
  });

  api.get("/review", (c) => {
    const open = c.req.query("open") === "1" || c.req.query("open") === "true";
    const items = model.pending.review.filter((r) => !open || !r.reviewed);
    return c.json({ total: items.length, items: items.map(({ line: _, ...r }) => r) });
  });

  api.get("/subjects", (c) =>
    c.json({ subjects: model.taken.subjects.map((s) => ({ slug: s.slug, summary: s.summary, steps: s.steps.length })) }),
  );

  api.get("/subjects/:slug", (c) => {
    const s = model.subjectBySlug.get(c.req.param("slug"));
    if (!s) return c.json(notFound(`subject ${c.req.param("slug")}`, "GET /api/subjects lists them"), 404);
    return c.json({ slug: s.slug, summary: s.summary, lead: s.lead, paragraphs: s.paragraphs, steps: s.steps, binds: s.binds });
  });

  api.get("/retired", (c) => {
    const q = c.req.query("q")?.toLowerCase();
    const rows = model.retired.rows.filter((r) => !q || `${r.retired} ${r.replacedBy} ${r.note}`.toLowerCase().includes(q));
    return c.json({
      total: rows.length,
      rows: rows.map((r) => ({ area: r.area, retired: r.retired, replacedBy: r.replacedBy, decisions: r.decisions, note: r.note })),
    });
  });

  api.get("/fronts", (c) => {
    const version = c.req.query("version") ?? model.tree.current;
    const owner = c.req.query("owner") ?? c.req.query("machine");
    const fronts = model.fronts.filter((f) => f.version === version && (!owner || (owner === "none" ? !f.owner : f.owner === owner)));
    return c.json({
      version,
      fronts: fronts.map((f) => ({ num: f.num, ref: f.ref, owner: f.owner ?? null, title: f.title, docs: f.docs.length })),
    });
  });

  api.get("/fronts/:num", (c) => {
    const num = int(c.req.param("num"), -1);
    const version = c.req.query("version") ?? model.tree.current;
    const fronts = model.fronts.filter((f) => f.num === num && f.version === version);
    if (!fronts.length) return c.json(notFound(`front ${c.req.param("num")} in ${version}`, "GET /api/fronts lists them"), 404);
    const mention = new RegExp(`(^|[^\\d])${num}([^\\d]|$)`);
    return c.json({
      version,
      fronts: fronts.map((f) => ({ ref: f.ref, owner: f.owner ?? null, title: f.title, docs: f.docs })),
      // Rows whose Binds name the front's number (`machine-1/150`, "front 150", "150 s31").
      binds: model.steps.rows.filter((r) => r.status === "in-force" && mention.test(r.binds)).map((r) => r.num),
    });
  });

  api.get("/docs/*", (c) => {
    let ref = decodeURIComponent(c.req.path.replace(/^\/api\/docs\//, "")).replace(/\.md$/, "").replace(/\/$/, "");
    // A ref from before the tree was flattened (1.0.12-beta/machine-1/150-rakun/README) answers as its new one.
    const moved = model.docByRef.has(ref) || model.docByRef.has(`${ref}/README`) ? undefined : (model.tree.moved.get(ref) ?? model.tree.moved.get(`${ref}/README`));
    if (moved?.startsWith("https://")) return c.json({ ...notFound(`doc ${ref}`, `removed when the tree was flattened; it is at ${moved}`), movedTo: moved }, 404);
    if (moved) ref = moved;
    const doc = model.docByRef.get(ref) ?? model.docByRef.get(`${ref}/README`);
    if (!doc) return c.json(notFound(`doc ${ref}`, "GET /api/search?q=… or /api/fronts to find one"), 404);
    const outline = doc.sections.map((s) => ({ level: s.level, heading: s.heading, anchor: s.anchor, lines: s.end - s.start, etag: sectionEtag(doc, s.anchor)! }));
    if (c.req.query("outline") !== undefined) return c.json({ ref: doc.ref, title: doc.title, outline });
    const anchor = c.req.query("section");
    if (anchor) {
      const text = sectionText(doc, anchor);
      if (text === undefined) return c.json({ ...notFound(`section ${anchor} of ${doc.ref}`), outline }, 404);
      // The etag goes back with an edit of this section (specs-bot doc edit), so a stale edit is refused.
      return c.json({ ref: doc.ref, title: doc.title, section: anchor, etag: etagOf(text), text });
    }
    return c.json({ ref: doc.ref, title: doc.title, version: doc.version, frozen: doc.version !== model.tree.current, meta: doc.meta, outline, text: doc.lines.join("\n") });
  });

  api.get("/chat", (c) => {
    const to = c.req.query("to");
    const unread = c.req.query("unread");
    const limit = Math.min(int(c.req.query("limit"), 20), 200);
    const list = model.chat
      .filter((m) => !to || m.to === to || (m.to === "all" && to in m.read))
      .filter((m) => !unread || m.read[unread] === false)
      .slice(-limit)
      .reverse();
    return c.json({
      messages: list.map((m) => ({ id: m.id, at: m.at, from: m.from, to: m.to, purpose: m.purpose, subject: m.subject, read: m.read })),
    });
  });

  api.get("/chat/:id", (c) => {
    const m = model.messageById.get(c.req.param("id"));
    if (!m) return c.json(notFound(`message ${c.req.param("id")}`), 404);
    const { lines: _, ref: __, ...rest } = m;
    return c.json(rest);
  });

  // The spec files a consumer outside the bot still reads as files (botopink/projects' gate scripts), by set —
  // never a path the caller chooses. Paths are relative to specs/.
  api.get("/export/:set", (c) => {
    const set = c.req.param("set");
    const current = model.tree.current;
    const text = (ref: string) => model.docByRef.get(ref)?.lines.join("\n");
    const files: Record<string, string> = {};
    if (set === "ledger") {
      // decisions-split.py: the record, and the milestone's README with the current fronts' READMEs (the aliases).
      files["decisions-taken-steps.md"] = model.steps.lines.join("\n");
      for (const d of model.tree.docs) {
        if (d.version !== current || d.name !== "README" || d.ref.split("/").length !== 2) continue;
        files[`${d.ref}.md`] = d.lines.join("\n");
      }
    } else if (set === "language-gaps") {
      const gaps = text(`${MILESTONE_DIR}/language-gaps`);
      if (gaps === undefined) return c.json({ error: `${current} has no language-gaps.md` }, 404);
      files[`${MILESTONE_DIR}/language-gaps.md`] = gaps;
    } else {
      return c.json({ error: `no export ${set}`, hint: "ledger | language-gaps" }, 404);
    }
    return c.json({ set, version: current, files });
  });

  api.get("/check", (c) => {
    const findings = check(model);
    const severity = c.req.query("severity");
    return c.json({ summary: summarize(findings), findings: findings.filter((f) => !severity || f.severity === severity) });
  });

  return api;
}
