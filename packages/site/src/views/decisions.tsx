import type { GroupDoc, PendingEntry, StepRow } from "@specs-bot/core";
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

/** Lowercased text a group is found by in the page's filter box. */
function groupHaystack(g: GroupDoc): string {
  return [g.slug, g.summary, g.lead, ...g.rows.map((r) => String(r.num))].join(" ").toLowerCase();
}

/** In force / superseded counts of a group's record rows. */
function rowCounts(rows: StepRow[]) {
  const force = rows.filter((r) => r.status === "in-force").length;
  return { force, gone: rows.length - force };
}

/** Hides every `[data-q]` item the filter box's words are not all in; `/` focuses the box. */
const FILTER_SCRIPT = `(function(){var i=document.getElementById("gfilter");if(!i)return;
var items=[].slice.call(document.querySelectorAll("[data-q]")),out=document.getElementById("gcount");
function run(){var w=i.value.toLowerCase().split(/\\s+/).filter(Boolean),n=0;
items.forEach(function(el){var q=el.getAttribute("data-q"),ok=w.every(function(x){return q.indexOf(x)>=0});el.hidden=!ok;if(ok)n++;});
if(out)out.textContent=w.length?n+" of "+items.length:"";}
i.addEventListener("input",run);run();
document.addEventListener("keydown",function(e){if(e.key==="/"&&document.activeElement!==i){e.preventDefault();i.focus();}});})();`;

/** specs/decisions-taken/: the README's intro, then every group in the README's order. */
export function DecisionsPage(props: { data: SiteData; ctx: LinkContext; path: string }) {
  const { data } = props;
  const { readme, groups } = data.record;
  const at = readme.lines.indexOf("## Groups");
  const intro = (at < 0 ? readme.lines : readme.lines.slice(0, at)).filter((l) => !/^# /.test(l)).join("\n").trim();
  const list = readme.order.map((slug) => groups.get(slug)).filter((g): g is GroupDoc => g !== undefined);
  const missing = readme.order.filter((slug) => !groups.has(slug));
  const all = rowCounts(data.steps.rows);
  return (
    <Layout title="Decisions taken" path={props.path} prose>
      <h1>Decisions taken</h1>
      <p class="muted">
        <code>specs/decisions-taken/</code> · {list.length} groups · {data.steps.rows.length} steps ({all.force} in force, {all.gone} superseded) · next
        free <strong>{data.nextFree}</strong>
      </p>
      {intro ? <Html class="markdown" html={renderMarkdown(intro, props.ctx)} /> : null}
      <div class="front-tools" role="search">
        <input id="gfilter" type="search" placeholder="Filter groups — slug, summary or a step number  ( / )" aria-label="Filter groups" />
        <span id="gcount" class="muted small" />
      </div>
      <ul class="list groups">
        {list.map((g) => {
          const c = rowCounts(g.rows);
          const nums = g.rows.map((r) => r.num);
          return (
            <li data-q={groupHaystack(g)}>
              <div class="head">
                <a href={`/decisions/${g.slug}`}>
                  <strong>{g.slug}</strong>
                </a>
                <span class="muted small">
                  {g.rows.length} step{g.rows.length === 1 ? "" : "s"}
                  {nums.length ? ` · ${Math.min(...nums)}–${Math.max(...nums)}` : ""}
                </span>
                {c.gone ? <span class="badge s-overtaken">{c.gone} superseded</span> : null}
              </div>
              <div class="text">
                <Html inline html={renderInline(g.summary, props.ctx)} />
              </div>
            </li>
          );
        })}
      </ul>
      {missing.length ? <p class="warn small">Listed in the README with no file: {missing.join(", ")}.</p> : null}
      <script dangerouslySetInnerHTML={{ __html: FILTER_SCRIPT }} />
    </Layout>
  );
}

/** One file of specs/decisions-taken/: its prose (the subject), then its own record table. */
export function DecisionGroupPage(props: { data: SiteData; group: GroupDoc; ctx: LinkContext; path: string }) {
  const { data, group } = props;
  const order = data.record.readme.order.filter((s) => data.record.groups.has(s));
  const i = order.indexOf(group.slug);
  const prev = i > 0 ? order[i - 1] : undefined;
  const next = i >= 0 && i < order.length - 1 ? order[i + 1] : undefined;
  const cited = group.steps.map((n) => ({ n, row: data.stepByNum.get(n) }));
  const gone = cited.filter((c) => c.row && c.row.status !== "in-force");
  const rows = data.steps.rows.filter((r) => r.section === group.slug);
  const c = rowCounts(rows);
  return (
    <Layout title={group.slug} path={props.path} prose>
      <div class="crumbs">
        <a href="/decisions">Decisions taken</a> · <code>decisions-taken/{group.slug}.md</code>
      </div>
      <h1>{group.slug}</h1>
      <p class="muted">
        <Html inline html={renderInline(group.summary, props.ctx)} />
      </p>
      {group.lead ? (
        <p>
          <strong>
            <Html inline html={renderInline(group.lead, props.ctx)} />
          </strong>
        </p>
      ) : null}
      {group.paragraphs.length ? <Html class="markdown" html={renderMarkdown(group.paragraphs.join("\n\n"), props.ctx)} /> : null}
      {cited.length ? (
        <>
          <h2>Steps</h2>
          <p>
            {cited.map((x, k) => (
              <>
                {k > 0 ? ", " : ""}
                {x.row ? (
                  <a href={`/steps/${x.n}`} class={x.row.status === "in-force" ? "" : "s-overtaken"}>
                    {x.n}
                  </a>
                ) : (
                  <span class="bad">{x.n}</span>
                )}
              </>
            ))}
          </p>
          {gone.length ? (
            <p class="warn small">
              Cites {gone.length} superseded step{gone.length === 1 ? "" : "s"}:{" "}
              {gone.map((x, k) => (
                <>
                  {k > 0 ? ", " : ""}
                  <a href={`/steps/${x.n}`}>{x.n}</a> <StatusBadge status={x.row!.status} by={x.row!.supersededBy} />
                </>
              ))}
            </p>
          ) : null}
        </>
      ) : null}
      {group.binds ? (
        <>
          <h2>Binds</h2>
          <p>
            <Html inline html={renderInline(group.binds, props.ctx)} />
          </p>
        </>
      ) : null}
      <h2 id="record">
        Record <span class="muted small">· {rows.length} rows · {c.force} in force{c.gone ? ` · ${c.gone} superseded` : ""}</span>
      </h2>
      {rows.length ? (
        <ul class="list">
          {rows.map((r) => (
            <li class={r.status === "in-force" ? "" : "gone"} id={`s${r.num}`}>
              <div class="head">
                <a class="num" href={`/steps/${r.num}`}>
                  {r.num}
                </a>
                <StatusBadge status={r.status} by={r.supersededBy} />
                <span class="muted small">{r.id}</span>
              </div>
              <Html class="text" html={renderInline(r.rule, props.ctx)} />
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted">No rows in this group's record.</p>
      )}
      <p class="pager">
        {prev ? <a href={`/decisions/${prev}`}>← {prev}</a> : null} {next ? <a href={`/decisions/${next}`}>{next} →</a> : null}
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
