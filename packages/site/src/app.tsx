// The read-only site (PLAN.md § 4.1, phase 5): server-rendered pages over the core parsers' output, loaded once
// at startup. Mounted by the api at "/"; never shows a file path, only refs.
import { Hono } from "hono";
import { CSS } from "./css.ts";
import { type Loaded, loadSiteData } from "./data.ts";
import type { LinkContext } from "./markdown.ts";
import type { StatusFn } from "./status.ts";
import { PendingEntryPage, PendingPage, RetiredPage, ReviewPage, SubjectPage, SubjectsPage } from "./views/decisions.tsx";
import { DocPage, DocsPage, renderDoc } from "./views/docs.tsx";
import { Home } from "./views/home.tsx";
import { NotFound, Unavailable } from "./views/layout.tsx";
import { StepPage, StepsPage } from "./views/steps.tsx";

export interface SiteOptions {
  dataPath: string;
  status: StatusFn;
  version: string;
  /** Already loaded data (tests); loaded from dataPath when absent. */
  loaded?: Loaded;
}

export function createSite(opts: SiteOptions) {
  const loaded = opts.loaded ?? loadSiteData(opts.dataPath);
  const data = loaded.ok ? loaded.data : undefined;
  const refs: ReadonlySet<string> = new Set(data ? data.docByRef.keys() : []);
  const plain: LinkContext = { refs };
  const site = new Hono();

  site.get("/static/site.css", (c) => {
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(CSS);
  });

  site.get("/", async (c) => c.html(<Home data={data} status={await opts.status()} version={opts.version} />));

  // Every page below needs the data; without it they answer 503.
  site.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/api" || data) return next();
    return c.html(<Unavailable path={c.req.path} />, 503);
  });
  if (!data) return site;

  site.get("/steps", (c) => {
    const page = Number.parseInt(c.req.query("page") ?? "1", 10);
    const filter = {
      section: c.req.query("section") ?? "",
      status: c.req.query("status") ?? "",
      q: (c.req.query("q") ?? "").trim(),
      page: Number.isNaN(page) ? 1 : page,
    };
    return c.html(<StepsPage data={data} filter={filter} ctx={plain} path={c.req.path} />);
  });

  site.get("/steps/:n", (c) => {
    const row = /^\d+$/.test(c.req.param("n")) ? data.stepByNum.get(Number(c.req.param("n"))) : undefined;
    if (!row) {
      const n = c.req.param("n");
      const what = /^\d+$/.test(n) && Number(n) < data.nextFree ? `Step ${n} is not in the record (a number never used).` : `No step ${n}.`;
      return c.html(<NotFound path={c.req.path} what={what} back="/steps" backLabel="All steps" />, 404);
    }
    return c.html(<StepPage data={data} row={row} ctx={plain} path={c.req.path} />);
  });

  site.get("/pending", (c) => c.html(<PendingPage data={data} ctx={plain} path={c.req.path} />));

  site.get("/pending/:id", (c) => {
    const entry = data.entries.find((e) => e.id === c.req.param("id"));
    if (!entry) {
      const id = c.req.param("id");
      const answered = data.steps.rows.find((r) => r.id.split(/ · |, /).includes(id));
      const what = answered ? `Question ${id} was answered by step ${answered.num}.` : `No open question ${id}.`;
      return c.html(
        <NotFound
          path={c.req.path}
          what={what}
          back={answered ? `/steps/${answered.num}` : "/pending"}
          backLabel={answered ? `Step ${answered.num}` : "Open questions"}
        />,
        404,
      );
    }
    return c.html(<PendingEntryPage entry={entry} ctx={plain} path={c.req.path} />);
  });

  site.get("/review", (c) => c.html(<ReviewPage data={data} ctx={plain} path={c.req.path} />));

  site.get("/subjects", (c) => c.html(<SubjectsPage data={data} ctx={plain} path={c.req.path} />));

  site.get("/subjects/:slug", (c) => {
    const subject = data.subjectBySlug.get(c.req.param("slug"));
    if (!subject) {
      return c.html(<NotFound path={c.req.path} what={`No subject ${c.req.param("slug")}.`} back="/subjects" backLabel="All subjects" />, 404);
    }
    return c.html(<SubjectPage data={data} subject={subject} ctx={plain} path={c.req.path} />);
  });

  site.get("/retired", (c) => c.html(<RetiredPage data={data} q={(c.req.query("q") ?? "").trim()} ctx={plain} path={c.req.path} />));

  site.get("/docs", (c) => c.html(<DocsPage data={data} path={c.req.path} />));

  // The data never changes while the process runs, so each document is rendered once.
  const rendered = new Map<string, string>();

  site.get("/docs/*", (c) => {
    let ref = c.req.path.slice("/docs/".length);
    try {
      ref = decodeURIComponent(ref);
    } catch {
      // keep it as written
    }
    ref = ref.replace(/\.md$/, "").replace(/\/$/, "");
    const doc = data.docByRef.get(ref) ?? data.docByRef.get(`${ref}/README`);
    if (!doc) {
      return c.html(<NotFound path={c.req.path} what={`No document ${ref}.`} back="/docs" backLabel="All documents" />, 404);
    }
    if (doc.ref !== ref) return c.redirect(`/docs/${doc.ref}`);
    let html = rendered.get(doc.ref);
    if (html === undefined) rendered.set(doc.ref, (html = renderDoc(doc, { refs, from: doc.ref })));
    return c.html(<DocPage data={data} doc={doc} html={html} path={c.req.path} />);
  });

  return site;
}
