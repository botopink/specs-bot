// The read-only site (PLAN.md § 4.1, phase 5): server-rendered pages over the core parsers' output, loaded once
// at startup. Mounted by the api at "/"; never shows a file path, only refs.
import { Hono } from "hono";
import { CSS } from "./css.ts";
import { type Loaded, loadSiteData } from "./data.ts";
import type { LinkContext } from "./markdown.ts";
import type { StatusFn } from "./status.ts";
import { docHref, refOfPath, shortenDocLinks } from "./short-links.ts";
import { protectHtml } from "./translate.ts";
import { PendingEntryPage, PendingPage, RetiredPage, ReviewPage, SubjectPage, SubjectsPage } from "./views/decisions.tsx";
import { frontsHref, sectionOfFolder } from "./hierarchy.ts";
import { DocPage, renderDoc } from "./views/docs.tsx";
import { FrontsPage } from "./views/fronts.tsx";
import { buildProgress, type FrontProgress, type ProgressItem } from "./progress.ts";
import { FrontProgressPage, frontNodes } from "./views/progress.tsx";
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

  // Every page leaves code, identifiers and labels to the browser's translator untouched (translate.ts), and
  // links the current milestone's documents without their version (short-links.ts).
  const current = data?.tree.current ?? "";
  site.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.get("content-type")?.startsWith("text/html")) return;
    const html = shortenDocLinks(protectHtml(await c.res.text()), current);
    c.res = new Response(html, { status: c.res.status, headers: c.res.headers });
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

  // A front's progress is gathered once per milestone (the site is rebuilt over the model after every write).
  const progressCache = new Map<string, Map<number, FrontProgress>>();
  const progressOf = (version: string) => {
    let p = progressCache.get(version);
    if (!p) progressCache.set(version, (p = buildProgress(data, version)));
    return p;
  };
  const versionOf = (asked: string | undefined) => (asked && data.tree.versions.includes(asked) ? asked : data.tree.current);

  site.get("/fronts", (c) => {
    const version = versionOf(c.req.query("version"));
    return c.html(<FrontsPage data={data} version={version} path={c.req.path} progress={progressOf(version)} />);
  });

  site.get("/fronts/:num", (c) => {
    const version = versionOf(c.req.query("version"));
    const num = /^\d+$/.test(c.req.param("num")) ? Number(c.req.param("num")) : Number.NaN;
    const p = progressOf(version).get(num);
    if (!p || !frontNodes(data, version, num).length) {
      return c.html(<NotFound path={c.req.path} what={`No front ${c.req.param("num")} in ${version}.`} back={frontsHref(data, version)} backLabel="All fronts" />, 404);
    }
    return c.html(<FrontProgressPage data={data} p={p} path={c.req.path} ctx={plain} />);
  });

  // The documents are listed where they sit, in the Fronts page's sections; /docs stays a way in.
  site.get("/docs", (c) => {
    const asked = c.req.query("version");
    return c.redirect(frontsHref(data, asked && data.tree.versions.includes(asked) ? asked : data.tree.current));
  });

  // The data never changes while the process runs, so each document is rendered once.
  const rendered = new Map<string, string>();

  site.get("/docs/*", (c) => {
    let ref = c.req.path.slice("/docs/".length);
    try {
      ref = decodeURIComponent(ref);
    } catch {
      // keep it as written
    }
    // A path without a version is the current milestone's: /docs/machine-1/144-botopink-lang/README.
    ref = refOfPath(ref.replace(/\.md$/, "").replace(/\/$/, ""), current);
    const doc = data.docByRef.get(ref) ?? data.docByRef.get(`${ref}/README`);
    if (!doc) {
      // A folder with no README of its own (a former front, a track) is a section of the Fronts page.
      const section = sectionOfFolder(data, ref);
      if (section) return c.redirect(section);
      return c.html(<NotFound path={c.req.path} what={`No document ${ref}.`} back="/fronts" backLabel="All fronts" />, 404);
    }
    if (doc.ref !== ref) return c.redirect(docHref(doc.ref, current));
    let html = rendered.get(doc.ref);
    if (html === undefined) {
      // A table of steps reads each step's state from the front's progress (step-tables.ts).
      const steps = new Map<string, ProgressItem>();
      for (const p of progressOf(doc.version).values()) for (const s of p.steps) steps.set(s.label, s);
      rendered.set(doc.ref, (html = renderDoc(doc, { refs, from: doc.ref, steps, ...(doc.front ? { front: doc.front.num } : {}) })));
    }
    const progress = doc.front ? progressOf(doc.version).get(doc.front.num) : undefined;
    return c.html(<DocPage data={data} doc={doc} html={html} path={c.req.path} progress={progress} ctx={plain} />);
  });

  return site;
}
