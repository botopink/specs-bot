// `specs-bot check` — the rules the conventions state, run over the whole repository (PLAN.md § 5.5).
// An error breaks a rule a write must never break; a warning is a defect in today's data worth fixing by hand.
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { GroupDoc } from "./decisions/group.ts";
import { deriveGroupMeta, groupMetaProblems, staleGroupMeta } from "./decisions/meta.ts";
import { nextFree, statedNextFree } from "./decisions/steps.ts";
import { frontReadmeRef } from "./docs/doc.ts";
import { pendingEntries } from "./decisions/pending.ts";
import { checkGapMarkers } from "./gaps.ts";
import { groupFilesOnDisk, type Store } from "./store.ts";

export type Severity = "error" | "warning";

export interface Finding {
  code: string;
  severity: Severity;
  /** What it is about, as the api names it: "step 528", "pending 810-d", "subject rakun-ssr", a doc ref, a message id. */
  about: string;
  message: string;
}

export function check(store: Store): Finding[] {
  return [
    ...checkSteps(store),
    ...checkPending(store),
    ...checkSubjects(store),
    ...checkRetired(store),
    ...checkDocs(store),
    ...checkChat(store),
    ...checkGapMarkers(store),
    ...checkRecord(store),
  ];
}

const err = (code: string, about: string, message: string): Finding => ({ code, severity: "error", about, message });
const warn = (code: string, about: string, message: string): Finding => ({ code, severity: "warning", about, message });

function stepNumbers(store: Store): Set<number> {
  return new Set(store.steps.rows.map((r) => r.num));
}

function checkSteps(store: Store): Finding[] {
  const out: Finding[] = [];
  const { rows } = store.steps;
  const nums = stepNumbers(store);
  const seen = new Set<number>();
  for (const r of rows) {
    if (seen.has(r.num)) out.push(err("step-duplicate", `step ${r.num}`, `number ${r.num} is used twice`));
    seen.add(r.num);
    if (r.supersededBy !== undefined && !nums.has(r.supersededBy)) {
      out.push(err("step-superseded-by-missing", `step ${r.num}`, `${r.status} by ${r.supersededBy}, which is no row`));
    }
    if (r.barePipe) {
      out.push(warn("step-bare-pipe", `step ${r.num}`, "the rule holds a bare `|`; the row renders broken on GitHub — write it `\\|`"));
    }
  }
  const next = nextFree(store.steps);
  if (store.steps.statedNextFree !== next) {
    out.push(err("next-free-mismatch", "decisions-taken/README", `the head says ${store.steps.statedNextFree ?? "nothing"}, the rows make it ${next}`));
  }
  return out;
}

/** The pending ids a step row answers: its Id cell up to the first " · ", comma-separated. */
function answeredIds(store: Store): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of store.steps.rows) {
    for (const id of r.id.split(" · ")[0]!.split(",").map((s) => s.trim())) if (id) out.set(id, r.num);
  }
  return out;
}

function checkPending(store: Store): Finding[] {
  const out: Finding[] = [];
  const answered = answeredIds(store);
  const seen = new Set<string>();
  for (const e of pendingEntries(store.pending)) {
    if (seen.has(e.id)) out.push(err("pending-duplicate", `pending ${e.id}`, "the id is used twice"));
    seen.add(e.id);
    const row = answered.get(e.id);
    if (row !== undefined) out.push(err("pending-already-answered", `pending ${e.id}`, `step ${row} answers it; an answered id leaves the file`));
    if (e.fields.length === 0) out.push(warn("pending-no-fields", `pending ${e.id}`, "no Measured / Options / Recommendation / Blocks"));
  }
  const stated = statedNextFree(store.pending.head.join("\n"));
  const next = nextFree(store.steps);
  if (stated !== undefined && stated !== next) {
    out.push(err("next-free-mismatch", "decisions-pending", `the head says ${stated}, the record makes it ${next}`));
  }
  const nums = stepNumbers(store);
  for (const r of store.pending.review) {
    if (!nums.has(r.step)) out.push(err("review-step-missing", `review ${r.step}`, `step ${r.step} is no row`));
  }
  return out;
}

// A plain group (no lead, no paragraphs, no Steps, no Binds — unfiled.md's shape) never becomes a `Subject`
// (store.ts's loadRecord skips it, the same test the old decisions-taken.md's `##` blocks always passed by
// having nothing to parse there); checkSubjects below never sees one, under either layout, and needs no change.
function checkSubjects(store: Store): Finding[] {
  const out: Finding[] = [];
  const nums = stepNumbers(store);
  const slugs = new Set<string>();
  for (const s of store.taken.subjects) {
    const about = `subject ${s.slug}`;
    if (slugs.has(s.slug)) out.push(err("subject-duplicate", about, "the slug is used twice"));
    slugs.add(s.slug);
    for (const n of s.steps) if (!nums.has(n)) out.push(err("subject-step-missing", about, `Steps cites ${n}, which is no row`));
    if (!s.steps.length) out.push(err("subject-no-steps", about, "no Steps line"));
    if (!s.binds) out.push(err("subject-no-binds", about, "no Binds line"));
    if (!s.lead) out.push(warn("subject-no-lead", about, "the subject opens without its bold lead sentence"));
  }
  return out;
}

function checkRetired(store: Store): Finding[] {
  const nums = stepNumbers(store);
  return store.retired.rows.flatMap((r) =>
    r.steps.filter((n) => !nums.has(n)).map((n) => err("retired-step-missing", `retired ${r.retired}`, `cites ${n}, which is no row`)),
  );
}

// A web link, an anchor, or an absolute path (a sample site's route inside an example) is not a spec link.
const EXTERNAL = /^(https?:|mailto:|#|\/)/;

function checkDocs(store: Store): Finding[] {
  const out: Finding[] = [];
  for (const d of store.tree.docs) {
    // examples/ holds sample content (a blog post a library renders), not documents of the spec.
    if (d.ref.includes("/examples/")) continue;
    // Every document carries its metadata block, the milestone at least (meta.ts).
    if (d.metaError) out.push(err("doc-meta-invalid", d.ref, `its metadata block: ${d.metaError}`));
    else if (!d.meta.milestone) out.push(err("doc-meta-missing", d.ref, "has no metadata block with its milestone (---\nmilestone: …\n---)"));
    // owner is a front's: only its README holds it, and the documents under it inherit it.
    if (d.meta.owner && !(d.front && d.ref === frontReadmeRef(d.front))) {
      out.push(err("doc-owner-outside-front", d.ref, "owner belongs on the front's README alone (claim / assign set it there)"));
    }
    for (const link of d.links) {
      if (EXTERNAL.test(link)) continue;
      const target = normalize(join(dirname(d.ref), decodeURIComponent(link.split("#")[0]!)));
      // A link that leaves specs/ points into the code repositories; it is not this repository's to check.
      if (!target || target.startsWith("..")) continue;
      if (!existsSync(join(store.specsDir, target))) {
        out.push(warn("doc-link-broken", d.ref, `links to ${link}, which does not exist`));
      }
    }
  }
  return out;
}

function checkChat(store: Store): Finding[] {
  const out: Finding[] = [];
  const byId = new Map(store.chat.map((m) => [m.id, m]));
  const seen = new Set<string>();
  for (const m of store.chat) {
    if (seen.has(m.id)) out.push(err("chat-id-duplicate", `message ${m.id}`, "the id is used twice"));
    seen.add(m.id);
    for (const id of m.replyTo) {
      const target = byId.get(id);
      if (!target) out.push(err("chat-reply-missing", `message ${m.id}`, `answers ${id}, which is no message`));
    }
    const written = m.inReplyTo?.split(",").map((p) => p.trim().split(/\s+/)[0]!) ?? [];
    for (const w of written) {
      const target = m.replyTo.map((id) => byId.get(id)).find((t) => t && w.endsWith(`${t.id}.md`));
      if (target && w !== `${target.ref}.md`) {
        out.push(warn("chat-reply-path", `message ${m.id}`, `in-reply-to writes ${w}; the message is ${target.ref}.md`));
      }
    }
  }
  return out;
}

/**
 * The `decisions-taken/` directory layout: the README's listing against the directory's actual files.
 * A group's H1 slug disagreeing with its filename (`group-slug-mismatch`) is not reported here — `loadStore`
 * already refuses to load such a file (`parseGroup`'s `slugExpected` check throws), consistent with every other
 * malformed heading in this codebase (`parseSteps`, `parseTaken`): those throw too, rather than becoming a
 * `Finding`, so a build never runs checks over data it could not parse. Two groups sharing a slug is likewise not
 * checked for: a slug comes from a file's name (`<slug>.md`), and a directory cannot hold two files of the same
 * name, so `store.record.groups` (a `Map`) can never collide on one.
 */
function checkRecord(store: Store): Finding[] {
  const out: Finding[] = [];
  const { readme, groups } = store.record;
  const onDisk = groupFilesOnDisk(join(store.specsDir, "decisions-taken"));
  const listed = new Set(readme.order);
  for (const slug of onDisk) {
    if (!listed.has(slug)) {
      out.push(err("group-unlisted", `group ${slug}`, `decisions-taken/${slug}.md exists but the README's Groups does not list it`));
    }
  }
  for (const slug of readme.order) {
    if (!groups.has(slug)) {
      out.push(err("group-missing", `group ${slug}`, `the README's Groups lists ${slug}, but decisions-taken/${slug}.md does not exist`));
    }
  }
  for (const [slug, g] of groups) out.push(...checkGroupMeta(store, slug, g, listed));
  return out;
}

/** An exact stub of a superseded row in a group that carries a metadata block (the compact form). */
const SUPERSEDED_STUB = /^(Overtaken|Replaced|Reversed) by \d+$/;

/**
 * A group's metadata block (decisions/meta.ts), checked only when the file has one: a group without a block is
 * the layout before the block existed, and is not reported. Every finding is a warning while groups move to the
 * block one by one; they become errors once every group has one.
 */
function checkGroupMeta(store: Store, slug: string, g: GroupDoc, listed: Set<string>): Finding[] {
  const about = `group ${slug}`;
  if (g.metaError) return [warn("group-meta-invalid", about, `the metadata block cannot be read: ${g.metaError}`)];
  if (!g.meta) return [];
  const out: Finding[] = [];
  for (const p of groupMetaProblems(g.meta)) out.push(warn("group-meta-invalid", about, p));
  for (const s of staleGroupMeta(g.meta, deriveGroupMeta(g.rows, store.retired))) {
    out.push(warn("group-meta-stale", about, `${s.key} is ${JSON.stringify(s.have ?? null)}, the rows and retired.md give ${JSON.stringify(s.want)}`));
  }
  if (Array.isArray(g.meta.related)) {
    for (const r of g.meta.related) {
      if (r === slug) out.push(warn("group-related-self", about, "related names the group itself"));
      else if (typeof r === "string" && !listed.has(r)) out.push(warn("group-related-unknown", about, `related names ${r}, which the README's Groups does not list`));
    }
  }
  for (const r of g.rows) {
    if (r.status !== "in-force" && !SUPERSEDED_STUB.test(r.rule.trim())) {
      out.push(warn("group-superseded-not-stub", `step ${r.num}`, `a superseded row of ${slug} keeps its old text; the compact form is "${r.status[0]!.toUpperCase()}${r.status.slice(1)} by ${r.supersededBy ?? "N"}"`));
    }
  }
  return out;
}

export function summarize(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[`${f.severity} ${f.code}`] = (out[`${f.severity} ${f.code}`] ?? 0) + 1;
  return out;
}
