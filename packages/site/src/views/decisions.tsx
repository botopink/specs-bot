import type { PendingEntry, Subject } from "@specs-bot/core";
import type { SiteData } from "../data.ts";
import { type LinkContext, renderInline, renderMarkdown } from "../markdown.ts";
import { Html, Layout, StatusBadge, StepLinks } from "./layout.tsx";

function Fields(props: { entry: PendingEntry; ctx: LinkContext }) {
  return (
    <>
      {props.entry.fields.map((f) => (
        <div class="field">
          <span class="name">{f.name}.</span> <Html inline class="markdown" html={renderInline(f.text, props.ctx)} />
        </div>
      ))}
    </>
  );
}

export function PendingPage(props: { data: SiteData; ctx: LinkContext; path: string }) {
  const { data } = props;
  const sections = data.pending.sections.filter((s) => s.entries.length > 0);
  return (
    <Layout title="Pending" path={props.path} prose>
      <h1>Pending questions</h1>
      <p class="muted">
        {data.entries.length} open question{data.entries.length === 1 ? "" : "s"} the maintainer owes. Answered ids leave
        this page for <a href="/steps">the record</a>. The review table is on <a href="/review">Review</a>.
      </p>
      {sections.length === 0 ? <p>No question is open.</p> : null}
      {sections.map((s) => (
        <section>
          <h2>
            <Html inline html={renderInline(s.heading, props.ctx)} />
          </h2>
          {s.entries.map((e) => (
            <article class="card" style="margin: 12px 0">
              <h3 style="margin-top: 0">
                <a href={`/pending/${encodeURIComponent(e.id)}`}>
                  <code>{e.id}</code>
                </a>{" "}
                · <Html inline html={renderInline(e.title, props.ctx)} />
              </h3>
              <Fields entry={e} ctx={props.ctx} />
            </article>
          ))}
        </section>
      ))}
    </Layout>
  );
}

export function PendingEntryPage(props: { entry: PendingEntry; ctx: LinkContext; path: string }) {
  const { entry } = props;
  return (
    <Layout title={entry.id} path={props.path} prose>
      <div class="crumbs">
        <a href="/pending">Pending</a> · <Html inline html={renderInline(entry.section, props.ctx)} />
      </div>
      <h1>
        <code>{entry.id}</code> · <Html inline html={renderInline(entry.title, props.ctx)} />
      </h1>
      {entry.fields.length ? (
        <Fields entry={entry} ctx={props.ctx} />
      ) : (
        <Html class="markdown" html={renderMarkdown(entry.lines.slice(1).join("\n"), props.ctx)} />
      )}
    </Layout>
  );
}

export function ReviewPage(props: { data: SiteData; ctx: LinkContext; path: string }) {
  const { data } = props;
  const items = [...data.pending.review].sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || a.step - b.step);
  const open = items.filter((i) => !i.reviewed).length;
  return (
    <Layout title="Review" path={props.path}>
      <h1>To review</h1>
      <p class="muted">
        Decisions a fable took at the maintainer's delegation, and his answers to its questions, for his later review.{" "}
        {open} open of {items.length}.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reviewed</th>
              <th>Row</th>
              <th>Answered</th>
              <th>What was decided</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr>
                <td>{i.reviewed ? <span class="ok">✓ yes</span> : <span class="warn">open</span>}</td>
                <td>
                  {data.stepByNum.has(i.step) ? <a href={`/steps/${i.step}`}>{i.step}</a> : i.step}
                </td>
                <td>
                  <Html inline html={renderInline(i.answered, props.ctx)} />
                </td>
                <td>
                  <Html inline html={renderInline(i.summary, props.ctx)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

export function SubjectsPage(props: { data: SiteData; ctx: LinkContext; path: string }) {
  return (
    <Layout title="Subjects" path={props.path} prose>
      <h1>Subjects</h1>
      <p class="muted">The rules in force, one text per subject; every sentence traces to a step of the record.</p>
      <ul class="list">
        {props.data.taken.subjects.map((s) => (
          <li>
            <div class="head">
              <a href={`/subjects/${s.slug}`}>
                <strong>{s.slug}</strong>
              </a>
              <span class="muted small">{s.steps.length} steps</span>
            </div>
            <div class="text">
              <Html inline html={renderInline(s.summary, props.ctx)} />
            </div>
          </li>
        ))}
      </ul>
    </Layout>
  );
}

export function SubjectPage(props: { data: SiteData; subject: Subject; ctx: LinkContext; path: string }) {
  const { data, subject } = props;
  const cited = subject.steps.map((n) => ({ n, row: data.stepByNum.get(n) }));
  const gone = cited.filter((c) => c.row && c.row.status !== "in-force");
  return (
    <Layout title={subject.slug} path={props.path} prose>
      <div class="crumbs">
        <a href="/subjects">Subjects</a>
      </div>
      <h1>{subject.slug}</h1>
      <p class="muted">
        <Html inline html={renderInline(subject.summary, props.ctx)} />
      </p>
      {subject.lead ? (
        <p>
          <strong>
            <Html inline html={renderInline(subject.lead, props.ctx)} />
          </strong>
        </p>
      ) : null}
      <Html class="markdown" html={renderMarkdown(subject.paragraphs.join("\n\n"), props.ctx)} />
      <h2>Steps</h2>
      <p>
        {cited.map((c, i) => (
          <>
            {i > 0 ? ", " : ""}
            {c.row ? (
              <a href={`/steps/${c.n}`} class={c.row.status === "in-force" ? "" : "s-overtaken"}>
                {c.n}
              </a>
            ) : (
              <span class="bad">{c.n}</span>
            )}
          </>
        ))}
      </p>
      {gone.length ? (
        <p class="warn small">
          Cites {gone.length} superseded step{gone.length === 1 ? "" : "s"}:{" "}
          {gone.map((c, i) => (
            <>
              {i > 0 ? ", " : ""}
              <a href={`/steps/${c.n}`}>{c.n}</a> <StatusBadge status={c.row!.status} by={c.row!.supersededBy} />
            </>
          ))}
        </p>
      ) : null}
      <h2>Binds</h2>
      <p>
        <Html inline html={renderInline(subject.binds, props.ctx)} />
      </p>
    </Layout>
  );
}

export function RetiredPage(props: { data: SiteData; q: string; ctx: LinkContext; path: string }) {
  const { data } = props;
  const q = props.q.toLowerCase();
  const rows = data.retired.rows.filter(
    (r) => !q || `${r.retired}\n${r.replacedBy}\n${r.decisions}\n${r.note}`.toLowerCase().includes(q),
  );
  const areas = [...new Set(rows.map((r) => r.area))];
  return (
    <Layout title="Retired" path={props.path}>
      <h1>Retired forms</h1>
      <p class="muted">
        What was discontinued and what replaced it. {rows.length} of {data.retired.rows.length} shown.
      </p>
      <form class="filters" method="get" action="/retired">
        <input type="search" name="q" value={props.q} placeholder="Filter text" aria-label="Filter text" />
        <button type="submit">Filter</button>
      </form>
      {areas.map((area) => (
        <section>
          <h2>{area}</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Retired</th>
                  <th>Replaced by</th>
                  <th>Decisions</th>
                  <th>Since / note</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.area === area)
                  .map((r) => (
                    <tr>
                      <td>
                        <Html inline html={renderInline(r.retired, props.ctx)} />
                      </td>
                      <td>
                        <Html inline html={renderInline(r.replacedBy, props.ctx)} />
                      </td>
                      <td>
                        <StepLinks text={r.decisions} known={data.stepByNum} />
                      </td>
                      <td>
                        <Html inline html={renderInline(r.note, props.ctx)} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </Layout>
  );
}
