// A table whose first column is "Step" lists steps by label (`B-00a`, `s3`, `150 s31`). Each step cell gains the
// step's state from the front's progress and a link to where the step is written; a long index (the 144 README's
// "Step | Machine | Title", ~160 rows) also gets a summary, filters and its decision numbers linked.
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
const INDEX_ROWS = 20;

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

/** Decision numbers in a title — "431 (1): …", "(decision 434)", "(decisions 458, 459)" — linked to their rows. */
export function linkDecisions(html: string): string {
  return html
    .replace(/^(\d{2,4})((?: \(\d+\))?(?: \/ \d{2,4})*)(:|,| )/, (_, n, rest, end) => `<a class="dec" href="/steps/${n}">${n}</a>${rest.replace(/(\d{2,4})(?! ?\))/g, '<a class="dec" href="/steps/$1">$1</a>')}${end}`)
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
  const rows = t.rows.map((row) => {
    const item = stepOf(row[0]!.text, ctx);
    const machine = machineCol >= 0 ? row[machineCol]!.text.replace(/\[([^\]]+)\].*/, "$1").trim() : "";
    const cells = row.map((cell, i) => {
      let html = inline(cell.tokens);
      if (i === 0 && item) html = `<a class="step" href="${item.href}">${html}</a> ${badge(item)}`;
      else if (i === machineCol && item) html = `<a href="${item.href}">machine ${machine}</a>`;
      else if (i === titleCol) html = linkDecisions(html);
      const align = t.align[i] ? ` style="text-align:${t.align[i]}"` : "";
      return `<td${align}>${html}</td>`;
    });
    const attrs = `data-state="${item?.state ?? "unknown"}"${machine ? ` data-machine="${machine}"` : ""}`;
    return `<tr ${attrs}>${cells.join("")}</tr>`;
  });
  const head = `<thead><tr>${t.header.map((h) => `<th>${inline(h.tokens)}</th>`).join("")}</tr></thead>`;
  const table = `<table class="step-table">${head}<tbody>${rows.join("\n")}</tbody></table>`;
  if (t.rows.length < INDEX_ROWS) return table;

  const items = t.rows.map((r) => stepOf(r[0]!.text, ctx));
  const count = (s: ItemState) => items.filter((x) => x?.state === s).length;
  const known = items.filter(Boolean).length;
  const machines = machineCol >= 0 ? [...new Set(t.rows.map((r) => r[machineCol]!.text.replace(/\[([^\]]+)\].*/, "$1").trim()))].sort() : [];
  const pct = known ? Math.round((100 * count("done")) / known) : 0;
  const bar = known
    ? `<div class="progress" title="${count("done")} done · ${count("open")} open · ${count("blocked")} waiting"><span class="done" style="width:${(100 * count("done")) / t.rows.length}%"></span><span class="blocked" style="width:${(100 * count("blocked")) / t.rows.length}%"></span></div>`
    : "";
  const chip = (group: string, value: string, label: string, on = false) =>
    `<button type="button" class="chip${on ? " on" : ""}" data-group="${group}" data-value="${value}">${label}</button>`;
  const summary = `<div class="step-index-head">
<p><strong>${t.rows.length} steps</strong> · ${count("done")} done · ${count("open")} open · ${count("blocked")} waiting${known < t.rows.length ? ` · ${t.rows.length - known} not found in a README` : ""} — <strong>${pct}%</strong></p>
${bar}
<div class="filters" role="toolbar">
${chip("state", "", "All", true)}${chip("state", "open", "Open")}${chip("state", "blocked", "Waiting")}${chip("state", "done", "Done")}
${machines.length > 1 ? `<span class="sep"></span>${chip("machine", "", "Both machines", true)}${machines.map((m) => chip("machine", m, `Machine ${m}`)).join("")}` : ""}
<input type="search" class="step-filter" placeholder="Filter: B-162, wasm, 431…" aria-label="Filter the steps">
</div>
</div>`;
  return `<div class="step-index">${summary}${table}</div>`;
}

/** The filters of a step index; without it every row stays visible. */
export const STEP_INDEX_SCRIPT = `
document.querySelectorAll(".step-index").forEach(function (box) {
  var want = { state: "", machine: "" };
  var input = box.querySelector(".step-filter");
  function apply() {
    var q = (input && input.value || "").toLowerCase();
    box.querySelectorAll("tbody tr").forEach(function (tr) {
      var ok = (!want.state || tr.dataset.state === want.state) && (!want.machine || tr.dataset.machine === want.machine) && (!q || tr.textContent.toLowerCase().indexOf(q) >= 0);
      tr.hidden = !ok;
    });
  }
  box.querySelectorAll(".chip").forEach(function (b) {
    b.addEventListener("click", function () {
      want[b.dataset.group] = b.dataset.value;
      box.querySelectorAll('.chip[data-group="' + b.dataset.group + '"]').forEach(function (o) { o.classList.toggle("on", o === b); });
      apply();
    });
  });
  if (input) input.addEventListener("input", apply);
});`;
