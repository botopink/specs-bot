// `specs-bot check` — the rules the conventions state, run over the whole repository (PLAN.md § 5.5).
// An error breaks a rule a write must never break; a warning is a defect in today's data worth fixing by hand.
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { nextFree, statedNextFree } from "./decisions/steps.ts";
import { pendingEntries } from "./decisions/pending.ts";
import { checkGapMarkers } from "./gaps.ts";
import type { Store } from "./store.ts";

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
    out.push(err("next-free-mismatch", "decisions-taken-steps", `the head says ${store.steps.statedNextFree ?? "nothing"}, the rows make it ${next}`));
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

export function summarize(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[`${f.severity} ${f.code}`] = (out[`${f.severity} ${f.code}`] ?? 0) + 1;
  return out;
}
