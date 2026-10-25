import type { StepRow, StepStatus } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type LinkContext, renderInline, renderMarkdown } from "../markdown.ts";
import { Html, Layout, StatusBadge, StepLinks, preview } from "./layout.tsx";

export const PAGE_SIZE = 100;

export interface StepFilter {
  section: string;
  /** a StepStatus, or "superseded" for any of the three */
  status: string;
  q: string;
  page: number;
}

export function filterSteps(rows: StepRow[], f: StepFilter): StepRow[] {
  const q = f.q.toLowerCase();
  return rows.filter(
    (r) =>
      (!f.section || r.section === f.section) &&
      (!f.status || (f.status === "superseded" ? r.status !== "in-force" : r.status === (f.status as StepStatus))) &&
      (!q || String(r.num) === q || `${r.id}\n${r.rule}\n${r.binds}\n${r.cell}`.toLowerCase().includes(q)),
  );
}

export function StepsPage(props: { data: SiteData; filter: StepFilter; ctx: LinkContext; path: string }) {
  const { data, filter } = props;
  const sections = [...new Set(data.steps.rows.map((r) => r.section))];
  const rows = filterSteps(data.steps.rows, filter).sort((a, b) => a.num - b.num);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, filter.page), pages);
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const link = (p: number) => {
    const qs = new URLSearchParams();
    if (filter.section) qs.set("section", filter.section);
    if (filter.status) qs.set("status", filter.status);
    if (filter.q) qs.set("q", filter.q);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/steps?${s}` : "/steps";
  };

  return (
    <Layout title="Steps" path={props.path}>
      <h1>Steps</h1>
      <p class="muted">
        The record: one row per decision taken. {rows.length} of {data.steps.rows.length} shown
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}.
      </p>
      <form class="filters" method="get" action="/steps">
        <input type="search" name="q" value={filter.q} placeholder="Number or text" aria-label="Filter text" />
        <select name="section" aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => (
            <option value={s} selected={s === filter.section}>
              {s}
            </option>
          ))}
        </select>
        <select name="status" aria-label="Status">
          {[
            ["", "Any status"],
            ["in-force", "In force"],
            ["superseded", "Superseded"],
            ["overtaken", "Overtaken"],
            ["replaced", "Replaced"],
            ["reversed", "Reversed"],
          ].map(([v, l]) => (
            <option value={v} selected={v === filter.status}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      <ul class="list">
        {shown.map((r) => (
          <li class={r.status === "in-force" ? "" : "gone"}>
            <div class="head">
              <a class="num" href={`/steps/${r.num}`}>
                {r.num}
              </a>
              <StatusBadge status={r.status} by={r.supersededBy} />
              <span class="muted small">{r.id}</span>
            </div>
            <Html class="text" html={renderInline(preview(r.rule), props.ctx)} />
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <p>
          {page > 1 ? <a href={link(page - 1)}>← previous</a> : null} {page < pages ? <a href={link(page + 1)}>next →</a> : null}
        </p>
      ) : null}
    </Layout>
  );
}

export function StepPage(props: { data: SiteData; row: StepRow; ctx: LinkContext; path: string }) {
  const { data, row } = props;
  const subjects = data.subjectsByStep.get(row.num) ?? [];
  const retired = data.retiredByStep.get(row.num) ?? [];
  const superseded = data.supersedes.get(row.num) ?? [];
  const by = row.supersededBy !== undefined ? data.stepByNum.get(row.supersededBy) : undefined;

  return (
    <Layout title={`Step ${row.num}`} path={props.path} prose>
      <div class="crumbs">
        <a href="/steps">Steps</a> · <Html inline html={renderInline(row.section, props.ctx)} />
      </div>
      <h1>
        Step {row.num} <StatusBadge status={row.status} by={row.supersededBy} />
      </h1>
      {row.supersededBy !== undefined ? (
        <p>
          {row.status[0]!.toUpperCase() + row.status.slice(1)} by{" "}
          {by ? <a href={`/steps/${by.num}`}>step {by.num}</a> : <>step {row.supersededBy} (not in the record)</>}.
        </p>
      ) : null}
      <dl class="meta">
        <dt>Id</dt>
        <dd>
          <Html inline html={renderInline(row.id, props.ctx)} />
        </dd>
        <dt>Binds</dt>
        <dd>{row.binds ? <Html inline html={renderInline(row.binds, props.ctx)} /> : <span class="muted">—</span>}</dd>
        <dt>Cell</dt>
        <dd>{row.cell ? <code>{row.cell}</code> : <span class="muted">—</span>}</dd>
        {row.process || row.delegated ? (
          <>
            <dt>Marks</dt>
            <dd>
              {row.process ? "process (fixes no program behaviour)" : ""}
              {row.process && row.delegated ? " · " : ""}
              {row.delegated ? "† decided under the maintainer's delegation" : ""}
            </dd>
          </>
        ) : null}
      </dl>
      <h2>Rule</h2>
      <Html class="rule markdown" html={renderMarkdown(row.rule, props.ctx)} />
      {row.barePipe ? (
        <p class="warn small">This row holds a bare “|” in its rule, so GitHub renders the record's table broken here.</p>
      ) : null}
      {superseded.length ? (
        <>
          <h2>Supersedes</h2>
          <ul>
            {superseded.map((s) => (
              <li>
                <a href={`/steps/${s.num}`}>step {s.num}</a> <span class="muted">({s.status})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>Cited by subjects</h2>
      {subjects.length ? (
        <ul>
          {subjects.map((s) => (
            <li>
              <a href={`/subjects/${s.slug}`}>{s.slug}</a> <span class="muted">— {s.summary}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No subject of decisions-taken cites this step.</p>
      )}
      {retired.length ? (
        <>
          <h2>Retired forms citing it</h2>
          <ul>
            {retired.map((r) => (
              <li>
                <Html inline html={renderInline(r.retired, props.ctx)} /> →{" "}
                <Html inline html={renderInline(r.replacedBy, props.ctx)} />{" "}
                <span class="muted small">
                  (<StepLinks text={r.decisions} known={data.stepByNum} />)
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Layout>
  );
}
