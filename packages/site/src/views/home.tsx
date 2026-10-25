import type { SiteData } from "../data.ts";
import type { SiteStatus } from "../status.ts";
import { Layout } from "./layout.tsx";

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

function Overview({ data }: { data: SiteData }) {
  const byStatus = { "in-force": 0, overtaken: 0, replaced: 0, reversed: 0 };
  for (const r of data.steps.rows) byStatus[r.status]++;
  const openReview = data.pending.review.filter((r) => !r.reviewed).length;
  const currentDocs = data.tree.docs.filter((d) => d.version === data.tree.current).length;
  const stated = data.statedNextFree;
  const agree = stated.steps === data.nextFree && stated.pending === data.nextFree;

  return (
    <>
      <h2>Milestone {data.tree.current}</h2>
      <div class="grid">
        <Card n={data.steps.rows.length} label="steps recorded" href="/steps" />
        <Card n={byStatus["in-force"]} label="steps in force" href="/steps?status=in-force" />
        <Card
          n={byStatus.overtaken + byStatus.replaced + byStatus.reversed}
          label={`superseded (${byStatus.overtaken} overtaken · ${byStatus.replaced} replaced · ${byStatus.reversed} reversed)`}
          href="/steps?status=superseded"
        />
        <Card n={data.entries.length} label="pending questions" href="/pending" />
        <Card n={openReview} label={`open review items of ${data.pending.review.length}`} href="/review" />
        <Card n={data.taken.subjects.length} label="subjects" href="/subjects" />
        <Card n={data.retired.rows.length} label="retired forms" href="/retired" />
        <Card n={currentDocs} label={`docs in ${data.tree.current} (${data.tree.docs.length} in all)`} href="/docs" />
      </div>
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

function Card(props: { n: number; label: string; href: string }) {
  return (
    <div class="card">
      <a href={props.href}>
        <div class="n">{props.n}</div>
        <div class="l">{props.label}</div>
      </a>
    </div>
  );
}
