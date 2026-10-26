import type { SiteData } from "../data.ts";
import { frontsHref, milestoneOf } from "../hierarchy.ts";
import type { SiteStatus } from "../status.ts";
import { Layout, plural, Title } from "./layout.tsx";

export function Home(props: { data: SiteData | undefined; status: SiteStatus; version: string }) {
  const { data, status } = props;
  return (
    <Layout title="specs-bot" path="/">
      <h1>specs-bot</h1>
      <p class="muted">The single door to the botopink specs · v{props.version}</p>
      <p>
        {status.ok ? (
          <>
            <span class="ok">online</span> · data <code>{status.branch}</code> @ <code>{status.head}</code>
          </>
        ) : (
          <>
            <span class="bad">data unavailable</span> · {status.error}
          </>
        )}
      </p>
      {data ? <Overview data={data} /> : <p class="bad">The specs could not be read.</p>}
      <p class="muted small">
        API: <a href="/api/health">/api/health</a>. Agents use the <code>specs-bot</code> CLI.
      </p>
    </Layout>
  );
}

/** The kinds a stat card can be; each has its accent colour in the stylesheet. */
type Kind = "steps" | "force" | "gone" | "pending" | "review" | "subjects" | "retired" | "docs";

function Overview({ data }: { data: SiteData }) {
  const byStatus = { "in-force": 0, overtaken: 0, replaced: 0, reversed: 0 };
  for (const r of data.steps.rows) byStatus[r.status]++;
  const superseded = byStatus.overtaken + byStatus.replaced + byStatus.reversed;
  const openReview = data.pending.review.filter((r) => !r.reviewed).length;
  const ms = milestoneOf(data, data.tree.current);
  const stated = data.statedNextFree;
  const agree = stated.steps === data.nextFree && stated.pending === data.nextFree;

  return (
    <>
      <h2>
        Milestone {data.tree.current} <span class="pill current">current</span>
      </h2>
      {ms.docs.length ? (
        <p class="milestone-docs">
          {ms.docs.map((d, i) => (
            <>
              {i ? " · " : ""}
              <a href={`/docs/${d.ref}`} title={d.title}>
                {d.name}
              </a>
            </>
          ))}
        </p>
      ) : null}
      <div class="grid">
        <Card kind="steps" n={data.steps.rows.length} label="Steps" detail={`recorded · next free ${data.nextFree}`} href="/steps" />
        <Card kind="force" n={byStatus["in-force"]} label="In force" detail="rules that hold today" href="/steps?status=in-force" />
        <Card
          kind="gone"
          n={superseded}
          label="Superseded"
          detail={`${byStatus.overtaken} overtaken · ${byStatus.replaced} replaced · ${byStatus.reversed} reversed`}
          href="/steps?status=superseded"
        />
        <Card kind="pending" n={data.entries.length} label="Pending" detail="questions the maintainer owes" href="/pending" />
        <Card kind="review" n={openReview} label="To review" detail={`of ${data.pending.review.length} delegated decisions`} href="/review" />
        <Card kind="subjects" n={data.taken.subjects.length} label="Subjects" detail="the rules in force, by subject" href="/subjects" />
        <Card kind="retired" n={data.retired.rows.length} label="Retired" detail="forms and what replaced them" href="/retired" />
        <Card
          kind="docs"
          n={ms.count}
          label="Documents"
          detail={`in ${data.tree.current} · ${data.tree.docs.length} in all`}
          href={frontsHref(data, data.tree.current)}
        />
      </div>

      <h2>Fronts</h2>
      <section class="machine-index">
          <div class="mini-grid">
            {ms.fronts.map((f) => (
              <a class="mini-card" href={frontsHref(data, ms.version, f.anchor)}>
                <span class="fnum">{f.num}</span>
                <span class="mini-body">
                  <span class="mini-name">{f.slug}</span>
                  {f.title ? (
                    <span class="mini-title">
                      <Title text={f.title} />
                    </span>
                  ) : null}
                  <span class="mini-meta">
                    {f.owner ? <span translate="no">{f.owner} · </span> : null}
                    {plural(f.count, "doc")}
                    {f.folders.length ? ` · ${plural(f.folders.length, "folder")}` : ""}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>

      <h2>Next free number</h2>
      <p>
        <strong>{data.nextFree}</strong>{" "}
        {agree ? (
          <span class="ok">— stated the same in the steps record and the pending page</span>
        ) : (
          <span class="warn">
            — the steps record states {stated.steps ?? "none"}, the pending page {stated.pending ?? "none"}
          </span>
        )}
      </p>
    </>
  );
}

function Card(props: { kind: Kind; n: number; label: string; detail: string; href: string }) {
  return (
    <a class={`card k-${props.kind}`} href={props.href}>
      <span class="n">{props.n}</span>
      <span class="l">{props.label}</span>
      <span class="d">{props.detail}</span>
    </a>
  );
}
