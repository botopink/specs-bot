// A front's progress as the pages show it: a bar, the counts and where they come from; the front's page lists
// every item; a document inside a front opens with a compact panel of it.
import type { SiteData } from "../data.ts";
import { type FrontNode, frontsHref, milestoneOf } from "../hierarchy.ts";
import { type LinkContext, renderInline } from "../markdown.ts";
import { type FrontProgress, type ItemState, percent, type ProgressItem } from "../progress.ts";
import { Html, Layout, plural, preview, Title } from "./layout.tsx";

const STATE_LABEL: Record<ItemState, string> = { done: "done", open: "open", blocked: "waiting" };

/** "Done · open · waiting" as a stacked bar. */
export function ProgressBar({ p }: { p: FrontProgress }) {
  const { done, open, blocked } = p.counts;
  const total = done + open + blocked;
  if (!total) return null;
  const w = (n: number) => `${((100 * n) / total).toFixed(1)}%`;
  return (
    <div class="pbar" role="img" aria-label={`${done} done, ${open} open, ${blocked} waiting`}>
      {done ? <span class="p-done" style={`width:${w(done)}`} /> : null}
      {blocked ? <span class="p-blocked" style={`width:${w(blocked)}`} /> : null}
    </div>
  );
}

/** Where the counts come from, said plainly: the progress is gathered, not stated anywhere. */
export function basisNote(p: FrontProgress): string {
  if (p.basis === "readme") return `from the README's ${plural(p.steps.length, "step")} and their boxes`;
  if (p.basis === "status") return `from ${plural(p.status.length, "item")} of status.md (the README has no steps)`;
  return "nothing found in the README or status.md";
}

export function ProgressLine({ p, href }: { p: FrontProgress; href?: string }) {
  const { done, open, blocked } = p.counts;
  const total = done + open + blocked;
  const counts = (
    <>
      <strong>{percent(p.counts)}%</strong> · {done} done · {open} open
      {blocked ? ` · ${blocked} waiting` : ""}
      {p.waiting.length ? ` · ${plural(p.waiting.length, "open question")}` : ""}
    </>
  );
  return (
    <div class="progress">
      <ProgressBar p={p} />
      <p class="pcounts">
        {total ? href ? <a href={href}>{counts}</a> : counts : <span class="muted">no steps found</span>}
        <span class="muted small"> — {basisNote(p)}</span>
      </p>
    </div>
  );
}

function Item({ item, ctx }: { item: ProgressItem; ctx: LinkContext }) {
  return (
    <li class={`pitem st-${item.state}`}>
      <span class={`badge st-${item.state}`}>{STATE_LABEL[item.state]}</span>{" "}
      <a href={item.href} class="plabel" translate="no">
        {item.label}
      </a>
      {item.lane ? <span class="lane" translate="no">{item.lane}</span> : null}
      {item.boxes ? (
        <span class="boxes" translate="no">
          {" "}
          {item.boxes.done}/{item.boxes.total}
        </span>
      ) : null}
      {item.text ? (
        <>
          {" "}
          <Html inline class="ptext" html={renderInline(preview(item.text, 220), ctx)} />
        </>
      ) : null}
    </li>
  );
}

function ItemList(props: { items: ProgressItem[]; ctx: LinkContext; collapse?: boolean; title: string }) {
  if (!props.items.length) return null;
  const order: ItemState[] = ["blocked", "open", "done"];
  const items = [...props.items].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const open = items.filter((i) => i.state !== "done");
  const done = items.filter((i) => i.state === "done");
  return (
    <section class="plist">
      <h2>{props.title}</h2>
      {open.length ? (
        <ul class="pitems">
          {open.map((i) => (
            <Item item={i} ctx={props.ctx} />
          ))}
        </ul>
      ) : (
        <p class="muted">Nothing open.</p>
      )}
      {done.length ? (
        <details class="pdone" open={!props.collapse}>
          <summary>{plural(done.length, "done item")}</summary>
          <ul class="pitems">
            {done.map((i) => (
              <Item item={i} ctx={props.ctx} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** The fronts of a milestone that carry this number (144 has a folder on each machine and a shared one). */
export function frontNodes(data: SiteData, version: string, num: number): FrontNode[] {
  return milestoneOf(data, version).machines.flatMap((m) => m.fronts.filter((f) => f.num === num));
}

export function frontProgressHref(data: SiteData, version: string, num: number): string {
  return `/fronts/${num}${version === data.tree.current ? "" : `?version=${encodeURIComponent(version)}`}`;
}

export function FrontProgressPage(props: { data: SiteData; p: FrontProgress; path: string; ctx: LinkContext }) {
  const { data, p } = props;
  const nodes = frontNodes(data, p.version, p.num);
  const first = nodes[0]!;
  return (
    <Layout title={`Front ${p.num} — progress`} path={props.path}>
      <nav class="crumbs" aria-label="Where this front sits">
        <a href={frontsHref(data, data.tree.current)}>Fronts</a>
        <span class="sep"> / </span>
        <a href={frontsHref(data, p.version)}>{p.version}</a>
        <span class="sep"> / </span>
        <span class="here" translate="no">
          {p.num}
        </span>
      </nav>
      <header class="front-head">
        <span class="fnum" translate="no">
          {p.num}
        </span>
        <div>
          <h1>
            <span translate="no">{first.slug}</span> <span class="muted">— progress</span>
          </h1>
          {first.title ? (
            <p class="ftitle">
              <Title text={first.title} />
            </p>
          ) : null}
          <p class="fmeta">
            {nodes.map((n, i) => (
              <>
                {i ? " · " : ""}
                <a href={frontsHref(data, p.version, n.anchor)} translate="no">
                  {n.machine ? `${n.machine}/${n.dir}` : n.dir}
                </a>
                {n.readme ? (
                  <>
                    {" ("}
                    <a href={`/docs/${n.readme.ref}`}>README</a>
                    {")"}
                  </>
                ) : null}
              </>
            ))}
          </p>
        </div>
      </header>
      <ProgressLine p={p} />
      <p class="muted small">
        Gathered from the specs, not stated in one place: the README's step headings and their <code>- [x]</code> boxes; status.md's
        items by lane (L1–L4 open, L5 blocked on a decision, Done landed); the open questions that name the front.
      </p>
      <ItemList title={`Waiting on ${plural(p.waiting.length, "question")}`} items={p.waiting} ctx={props.ctx} />
      <ItemList title="Steps — from the README" items={p.steps} ctx={props.ctx} collapse />
      <ItemList title="In status.md" items={p.status} ctx={props.ctx} collapse />
      {p.binds.length ? (
        <section class="plist">
          <h2>Decisions in force that bind it</h2>
          <p class="binds" translate="no">
            {p.binds.slice(0, 40).map((n, i) => (
              <>
                {i ? ", " : ""}
                <a href={`/steps/${n}`}>{n}</a>
              </>
            ))}
            {p.binds.length > 40 ? ` … ${p.binds.length - 40} more` : ""}
          </p>
        </section>
      ) : null}
    </Layout>
  );
}

/** At the top of a document inside a front: the front's progress, its open items first. */
export function DocProgressPanel(props: { data: SiteData; p: FrontProgress; ctx: LinkContext }) {
  const { p } = props;
  const next = [...p.waiting, ...(p.basis === "readme" ? p.steps : p.status).filter((i) => i.state !== "done")].slice(0, 5);
  const href = frontProgressHref(props.data, p.version, p.num);
  return (
    <aside class="doc-progress">
      <p class="dp-title">
        Front{" "}
        <a href={href} translate="no">
          {p.num}
        </a>{" "}
        — what is done, what is open
      </p>
      <ProgressLine p={p} href={href} />
      {next.length ? (
        <ul class="pitems compact">
          {next.map((i) => (
            <Item item={i} ctx={props.ctx} />
          ))}
        </ul>
      ) : null}
      <p class="small">
        <a href={href}>All of front {p.num}'s steps →</a>
      </p>
    </aside>
  );
}
