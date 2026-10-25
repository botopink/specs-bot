// A table whose first column is "Step" lists steps by label (`B-00a`, `s3`, `150 s31`). Each step cell gains the
// step's state from the front's progress and a link to where the step is written; a long index (the 144 README's
// "Step | Machine | Title", ~160 rows) also gets a summary, filters with counts, its lettered groups (B-00a … k)
// headed, and its decision numbers linked.
import type { Tokens } from "marked";
import type { ItemState, ProgressItem } from "./progress.ts";

export interface StepTableContext {
  /** The front the document belongs to: a bare label ("B-00a") is this front's. */
  front?: number;
  /** "144 B-00a" → the step as the front's progress knows it. */
  steps?: ReadonlyMap<string, ProgressItem>;
}

const LABEL = /^(?:(\d{1,3})\s+)?(s\d+[a-z]?|B-\d+[a-z0-9]*(?:-[a-z0-9]+)*)$/;
const STATE_TEXT: Record<ItemState, string> = { done: "done", open: "open", blocked: "waiting" };
/** An index this long gets the summary and the filters. */
export const INDEX_ROWS = 20;

export function isStepTable(t: Tokens.Table): boolean {
  return t.header[0]?.text.trim() === "Step";
}

/** The progress item of a step cell's label, if the front's progress knows it. */
export function stepOf(cell: string, ctx: StepTableContext): ProgressItem | undefined {
  const m = cell.trim().match(LABEL);
  if (!m || !ctx.steps) return undefined;
  const front = m[1] ? Number(m[1]) : ctx.front;
  return front === undefined ? undefined : ctx.steps.get(`${front} ${m[2]}`);
}

/** "B-00a" → "B-00": lettered steps of one number are a group. Anything else has none. */
export function groupOf(cell: string): string | undefined {
  return cell.trim().match(/^(B-\d+)[a-z]$/)?.[1];
}

/** Decision numbers in a title — "431 (1): …", "(decision 434)", "(decisions 458, 459)" — linked to their rows. */
export function linkDecisions(html: string): string {
  return html
    .replace(
      /^(\d{2,4})((?: \(\d+\))?(?: \/ \d{2,4})*)(:|,| )/,
      (_, n, rest, end) => `<a class="dec" href="/steps/${n}">${n}</a>${rest.replace(/(\d{2,4})(?! ?\))/g, '<a class="dec" href="/steps/$1">$1</a>')}${end}`,
    )
    .replace(/\b(decisions?) ((?:\d{2,4}(?:, | and |–)?)+)/g, (_, word, list) => `${word} ${list.replace(/\d{2,4}/g, (n: string) => `<a class="dec" href="/steps/${n}">${n}</a>`)}`);
}

function badge(item: ProgressItem): string {
  const boxes = item.boxes ? ` ${item.boxes.done}/${item.boxes.total}` : "";
  return `<span class="state ${item.state}" title="from the front's README">${STATE_TEXT[item.state]}${boxes}</span>`;
}

export interface RenderCell {
  (tokens: Tokens.TableCell["tokens"]): string;
}

/** The table as HTML; `inline` renders a cell's tokens as the document's renderer does. */
export function renderStepTable(t: Tokens.Table, inline: RenderCell, ctx: StepTableContext): string {
  const machineCol = t.header.findIndex((h) => h.text.trim() === "Machine");
  const titleCol = t.header.findIndex((h) => h.text.trim() === "Title" || h.text.trim() === "What");
  const machineOf = (row: Tokens.TableCell[]) => (machineCol >= 0 ? row[machineCol]!.text.replace(/\[([^\]]+)\].*/, "$1").trim() : "");
  const items = t.rows.map((r) => stepOf(r[0]!.text, ctx));
  const groups = t.rows.map((r) => groupOf(r[0]!.text));
  const size = new Map<string, number>();
  for (const g of groups) if (g) size.set(g, (size.get(g) ?? 0) + 1);
  // On a phone the Machine column folds away (the step's link already goes to its machine's README).
  const colClass = (i: number) => (i === machineCol ? ' class="col-machine"' : "");

  const body: string[] = [];
  let opened: string | undefined;
  t.rows.forEach((row, r) => {
    const item = items[r];
    const machine = machineOf(row);
    // A group of lettered steps (B-00a … B-00k) opens with one row naming it and how far it is.
    const g = groups[r] && size.get(groups[r]!)! > 1 ? groups[r] : undefined;
    if (g && g !== opened) {
      const members = items.filter((_, k) => groups[k] === g);
      const done = members.filter((x) => x?.state === "done").length;
      body.push(
        `<tr class="group" data-group="${g}"><th colspan="${t.header.length}" scope="rowgroup"><span translate="no">${g}</span> · ${members.length} steps · ${done} done</th></tr>`,
      );
    }
    opened = g;
    const cells = row.map((cell, i) => {
      let html = inline(cell.tokens);
      if (i === 0 && item) html = `<a class="step" href="${item.href}">${html}</a> ${badge(item)}`;
      else if (i === machineCol && item) html = `<a href="${item.href}">machine ${machine}</a>`;
      else if (i === titleCol) html = linkDecisions(html);
      const align = t.align[i] ? ` style="text-align:${t.align[i]}"` : "";
      return `<td${colClass(i)}${align}>${html}</td>`;
    });
    const attrs = `data-state="${item?.state ?? "unknown"}"${machine ? ` data-machine="${machine}"` : ""}${g ? ` data-in="${g}"` : ""}`;
    body.push(`<tr ${attrs}>${cells.join("")}</tr>`);
  });
  const head = `<thead><tr>${t.header.map((h, i) => `<th${colClass(i)}>${inline(h.tokens)}</th>`).join("")}</tr></thead>`;
  const table = `<table class="step-table">${head}<tbody>${body.join("\n")}</tbody></table>`;
  if (t.rows.length < INDEX_ROWS) return `<div class="table-wrap">${table}</div>`;

  const count = (s: ItemState) => items.filter((x) => x?.state === s).length;
  const known = items.filter(Boolean).length;
  const machines = machineCol >= 0 ? [...new Set(t.rows.map(machineOf))].sort() : [];
  const pct = known ? Math.round((100 * count("done")) / known) : 0;
  const bar = known
    ? `<div class="progress" title="${count("done")} done · ${count("open")} open · ${count("blocked")} waiting"><span class="done" style="width:${(100 * count("done")) / t.rows.length}%"></span><span class="blocked" style="width:${(100 * count("blocked")) / t.rows.length}%"></span></div>`
    : "";
  const chip = (filter: string, value: string, label: string, n: number | undefined, on = false) =>
    `<button type="button" class="chip${on ? " on" : ""}" data-filter="${filter}" data-value="${value}" aria-pressed="${on}">${label}${n === undefined ? "" : ` <span class="n">${n}</span>`}</button>`;
  const summary = `<div class="step-index-head">
<p><strong>${t.rows.length} steps</strong> · ${count("done")} done · ${count("open")} open · ${count("blocked")} waiting${known < t.rows.length ? ` · ${t.rows.length - known} not found in a README` : ""} — <strong>${pct}%</strong></p>
${bar}
<div class="filters" role="toolbar" aria-label="Filter the steps">
${chip("state", "", "All", t.rows.length, true)}${chip("state", "open", "Open", count("open"))}${chip("state", "blocked", "Waiting", count("blocked"))}${chip("state", "done", "Done", count("done"))}
${machines.length > 1 ? `<span class="sep"></span>${chip("machine", "", "Both machines", undefined, true)}${machines.map((m) => chip("machine", m, `Machine ${m}`, t.rows.filter((r) => machineOf(r) === m).length)).join("")}` : ""}
<input type="search" class="step-filter" placeholder="Filter: B-162, wasm, 431…" aria-label="Filter the steps by text">
<span class="shown muted small" aria-live="polite"></span>
</div>
</div>`;
  return `<div class="step-index">${summary}<div class="table-wrap">${table}</div></div>`;
}

/** The filters of a step index; without it every row stays visible. */
export const STEP_INDEX_SCRIPT = `
document.querySelectorAll(".step-index").forEach(function (box) {
  var want = { state: "", machine: "" };
  var input = box.querySelector(".step-filter");
  var shown = box.querySelector(".shown");
  function apply() {
    var q = (input && input.value || "").trim().toLowerCase();
    var n = 0, all = 0;
    box.querySelectorAll("tbody tr[data-state]").forEach(function (tr) {
      var ok = (!want.state || tr.dataset.state === want.state) && (!want.machine || tr.dataset.machine === want.machine) && (!q || tr.textContent.toLowerCase().indexOf(q) >= 0);
      tr.hidden = !ok;
      all++; if (ok) n++;
    });
    box.querySelectorAll("tbody tr.group").forEach(function (g) {
      g.hidden = !box.querySelector('tbody tr[data-in="' + g.dataset.group + '"]:not([hidden])');
    });
    if (shown) shown.textContent = n === all ? "" : n + " of " + all + " shown";
  }
  box.querySelectorAll(".chip").forEach(function (b) {
    b.addEventListener("click", function () {
      want[b.dataset.filter] = b.dataset.value;
      box.querySelectorAll('.chip[data-filter="' + b.dataset.filter + '"]').forEach(function (o) {
        o.classList.toggle("on", o === b);
        o.setAttribute("aria-pressed", String(o === b));
      });
      apply();
    });
  });
  if (input) input.addEventListener("input", apply);
});`;
