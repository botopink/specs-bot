// The site's one stylesheet, served at /static/site.css.
export const CSS = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --surface: #ffffff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e4e2;
  --accent: #b5246b; --accent-soft: #fbe7f0; --code-bg: #f2f2ef;
  --ok: #1a7f37; --warn: #9a6700; --bad: #c62828; --gone: #8a8a8f;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --shadow: 0 1px 2px rgb(0 0 0 / 4%), 0 4px 14px rgb(0 0 0 / 5%);
  --shadow-hover: 0 2px 4px rgb(0 0 0 / 6%), 0 10px 28px rgb(0 0 0 / 9%);
  /* One accent per kind of card. */
  --k-steps: #4f5bd5; --k-force: #1a7f37; --k-gone: #7a7a80; --k-pending: #b26b00;
  --k-review: #8250df; --k-subjects: #0f7b8a; --k-retired: #c2410c; --k-docs: #b5246b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131315; --surface: #1b1b1e; --fg: #e8e8ea; --muted: #9c9ca3; --line: #2c2c31;
    --accent: #f27bb0; --accent-soft: #3a1c2a; --code-bg: #232327;
    --ok: #4ac26b; --warn: #d29922; --bad: #ff6b6b; --gone: #77777d;
    --shadow: 0 1px 2px rgb(0 0 0 / 30%); --shadow-hover: 0 6px 22px rgb(0 0 0 / 45%);
    --k-steps: #8b93ff; --k-force: #4ac26b; --k-gone: #9c9ca3; --k-pending: #e3a43a;
    --k-review: #b392f0; --k-subjects: #4cc3d1; --k-retired: #fb8c5a; --k-docs: #f27bb0;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre { font-family: var(--mono); font-size: 0.88em; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; overflow-wrap: anywhere; }
pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; }

header.top { border-bottom: 1px solid var(--line); background: var(--surface); position: sticky; top: 0; z-index: 2; }
header.top .bar { max-width: 1080px; margin: 0 auto; padding: 10px 16px; display: flex; gap: 6px 18px; align-items: center; flex-wrap: wrap; }
header.top .brand { font-weight: 700; color: var(--fg); margin-right: 8px; }
header.top nav { display: flex; gap: 4px 14px; flex-wrap: wrap; }
header.top nav a { color: var(--muted); font-size: 15px; }
header.top nav a.on { color: var(--fg); font-weight: 600; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
main.prose { max-width: 820px; }
h1 { font-size: 26px; line-height: 1.25; margin: 0 0 6px; }
h2 { font-size: 20px; margin: 32px 0 10px; }
h3 { font-size: 17px; margin: 24px 0 8px; }
.muted { color: var(--muted); }
.small { font-size: 14px; }
.crumbs { font-size: 14px; color: var(--muted); margin-bottom: 8px; overflow-wrap: anywhere; }

/* Stat cards: the number, a short label, one muted line of detail; the kind's colour on the edge and the number. */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin: 16px 0 8px; }
a.card {
  --k: var(--accent);
  position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0;
  background: var(--surface); color: var(--fg); border: 1px solid var(--line); border-radius: 14px;
  padding: 16px 18px 14px 20px; box-shadow: var(--shadow); overflow: hidden;
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
a.card::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--k); }
a.card::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--k) 10%, transparent), transparent 60%);
}
a.card:hover { text-decoration: none; transform: translateY(-2px); box-shadow: var(--shadow-hover); border-color: color-mix(in srgb, var(--k) 45%, var(--line)); }
a.card:focus-visible { outline: 2px solid var(--k); outline-offset: 2px; }
a.card .n { font-size: 32px; font-weight: 750; line-height: 1.05; color: var(--k); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
a.card .l { font-weight: 650; font-size: 15px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.card .d { color: var(--muted); font-size: 13px; line-height: 1.4; }
.card.k-steps { --k: var(--k-steps); } .card.k-force { --k: var(--k-force); } .card.k-gone { --k: var(--k-gone); }
.card.k-pending { --k: var(--k-pending); } .card.k-review { --k: var(--k-review); } .card.k-subjects { --k: var(--k-subjects); }
.card.k-retired { --k: var(--k-retired); } .card.k-docs { --k: var(--k-docs); }

.pill { display: inline-block; vertical-align: middle; font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; letter-spacing: .02em; }
.pill.current { color: var(--k-force); background: color-mix(in srgb, var(--k-force) 14%, transparent); }
.pill.frozen-pill { color: var(--muted); background: color-mix(in srgb, var(--muted) 16%, transparent); }
.milestone-docs { margin: 0 0 4px; color: var(--muted); font-size: 15px; }

/* The fronts index on the overview: one mini card per front, under its machine. */
.machine-index h3 { margin: 18px 0 8px; }
.mini-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
a.mini-card {
  display: flex; gap: 12px; align-items: flex-start; min-width: 0; color: var(--fg);
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px;
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
a.mini-card:hover { text-decoration: none; transform: translateY(-1px); box-shadow: var(--shadow-hover); border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
.mini-body { display: flex; flex-direction: column; min-width: 0; }
.mini-name { font-weight: 650; }
.mini-title { color: var(--muted); font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mini-meta { color: var(--muted); font-size: 12px; margin-top: 2px; }

/* A front's number, as a badge. */
.fnum {
  flex: none; display: inline-grid; place-items: center; min-width: 44px; height: 32px; padding: 0 8px;
  font: 700 14px/1 var(--mono); color: var(--accent); background: var(--accent-soft); border-radius: 8px;
}

/* The Fronts page: a section per machine, a card per front, a row per folder inside it. */
.versions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; font-size: 14px; }
.versions a, .versions .on { padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); }
.versions a { color: var(--muted); } .versions a:hover { text-decoration: none; color: var(--fg); border-color: var(--muted); }
.versions .on { color: var(--fg); font-weight: 600; border-color: var(--fg); }
section.machine > h2 { margin-top: 36px; padding-bottom: 6px; border-bottom: 2px solid var(--line); }
.machine-docs { color: var(--muted); font-size: 15px; margin: 6px 0 14px; }
h1 a.anchor, h2 a.anchor, h3 a.anchor, h4 a.anchor { color: inherit; }
.front-card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow);
  padding: 16px 18px; margin: 14px 0; scroll-margin-top: 64px;
}
.front-card:target { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
.front-card header { display: flex; gap: 14px; align-items: flex-start; }
.front-card .fhead { min-width: 0; flex: 1; }
.front-card h3 { margin: 2px 0 0; font-size: 18px; }
.front-card .anchor-link { margin-left: 6px; color: var(--muted); font-weight: 400; opacity: 0; transition: opacity .15s; }
.front-card:hover .anchor-link { opacity: 1; }
.front-card .ftitle { margin: 2px 0 0; color: var(--fg); font-size: 15px; line-height: 1.45; }
.front-card .ftitle:empty { display: none; }
.front-card .fmeta { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.front-card .owner { padding: 1px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg); font-family: var(--mono, monospace); font-size: 12px; }
.front-card .owner:hover { text-decoration: none; border-color: var(--fg); }
.owners { margin-top: 0; }
.front-card .owner.free { color: var(--muted); border-style: dashed; }
.front-card > .chips { margin: 12px 0 0; }
.folders { margin-top: 12px; border-top: 1px solid var(--line); display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0 20px; }
.folder { padding: 10px 0 6px; border-bottom: 1px dashed var(--line); scroll-margin-top: 64px; min-width: 0; }
.folder h4 { margin: 0; font-size: 14.5px; font-weight: 600; line-height: 1.4; scroll-margin-top: 72px; }
.folder h4:target, .folder:has(h4:target) { background: var(--accent-soft); border-radius: 6px; }
.folder .fdir { font-family: var(--mono); font-size: 13px; color: var(--accent); }
.folder .ftitle { font-weight: 400; color: var(--fg); }
ul.chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 6px 0 0; }
a.chip {
  display: inline-block; font-size: 13px; padding: 1px 10px; border-radius: 999px; color: var(--fg);
  background: var(--code-bg); border: 1px solid var(--line); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
a.chip:hover { text-decoration: none; border-color: var(--accent); color: var(--accent); }
ul.doclist { margin: 4px 0 12px; padding-left: 18px; } ul.doclist li { margin: 2px 0; }
.doc-layout aside .inum { font-family: var(--mono); font-size: 12px; color: var(--accent); display: inline-block; min-width: 2.6em; }
.crumbs .sep { color: var(--line); } .crumbs .here { color: var(--fg); font-weight: 600; }
@media (max-width: 560px) {
  .front-card { padding: 14px; } .front-card header { gap: 10px; } .fnum { min-width: 38px; height: 28px; font-size: 13px; }
  .folders { grid-template-columns: 1fr; } a.card .n { font-size: 28px; }
}

.badge { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.s-in-force { color: var(--ok); } .s-overtaken, .s-replaced, .s-reversed { color: var(--gone); }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; } .warn { color: var(--warn); }

form.filters { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 16px; }
form.filters input, form.filters select, form.filters button {
  font: inherit; font-size: 15px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--fg);
}
form.filters input[type=search] { flex: 1 1 220px; min-width: 0; }
form.filters button { cursor: pointer; }

.list { list-style: none; padding: 0; margin: 0; }
.list > li { border-bottom: 1px solid var(--line); padding: 12px 0; }
.list .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.list .num { font-family: var(--mono); font-weight: 700; min-width: 3.2em; }
.list .text { margin-top: 4px; overflow-wrap: anywhere; }
.gone .text { color: var(--muted); }

table { border-collapse: collapse; width: 100%; font-size: 15px; }
.table-wrap { overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }

dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 16px 0; }
dl.meta dt { color: var(--muted); }
dl.meta dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 560px) { dl.meta { grid-template-columns: 1fr; } dl.meta dd { margin-bottom: 8px; } }

.field { margin: 10px 0; }
.field > .name { font-weight: 700; }
.rule { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 4px 18px; overflow-wrap: anywhere; }

.doc-layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 32px; align-items: start; }
.doc-layout aside { position: sticky; top: 64px; max-height: calc(100vh - 80px); overflow-y: auto; font-size: 14px; }
.doc-layout aside ul { list-style: none; padding: 0; margin: 0; }
.doc-layout aside li { margin: 4px 0; } .doc-layout aside li.l3 { padding-left: 12px; }
.doc-layout aside a { color: var(--muted); }
@media (max-width: 900px) { .doc-layout { grid-template-columns: 1fr; } .doc-layout aside { position: static; max-height: none; order: -1; border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; } }
.markdown { overflow-wrap: anywhere; }
.markdown h1 a.anchor, .markdown h2 a.anchor, .markdown h3 a.anchor, .markdown h4 a.anchor { color: inherit; }
.markdown table { display: block; overflow-x: auto; }
.markdown blockquote { margin: 0; padding: 0 14px; border-left: 3px solid var(--line); color: var(--muted); }
.unresolved { border-bottom: 1px dotted var(--muted); }

.frozen { color: var(--muted); font-weight: 400; font-size: 13px; }

/* A front's progress: a stacked bar (done, waiting; the rest open), the counts, the items. */
.progress { margin: 10px 0 12px; }
.pbar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--k-steps) 18%, var(--line)); }
.pbar .p-done { background: var(--ok); }
.pbar .p-blocked { background: var(--warn); }
.pcounts { margin: 6px 0 0; font-size: 14px; }
.pcounts a { color: inherit; }
.pcounts strong { color: var(--ok); }
.pitems { list-style: none; padding: 0; margin: 8px 0; }
.pitem { padding: 8px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.pitems.compact .pitem { padding: 5px 0; font-size: 14px; }
.pitem .plabel { font-family: var(--mono); font-size: 0.9em; font-weight: 600; }
.pitem .lane { margin-left: 6px; font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.pitem .boxes { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.badge.st-done { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.badge.st-open { background: color-mix(in srgb, var(--k-steps) 16%, transparent); color: var(--k-steps); }
.badge.st-blocked { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
.plist h2 { margin-top: 28px; }
.pdone summary { cursor: pointer; color: var(--muted); margin: 8px 0; }
.front-head { display: flex; gap: 14px; align-items: flex-start; margin: 8px 0; }
.front-head h1 { margin: 0; }
.front-head .fnum { flex: none; }
.doc-progress { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--ok); border-radius: 10px; padding: 10px 16px; margin: 12px 0 20px; box-shadow: var(--shadow); }
.doc-progress .dp-title { margin: 0; font-weight: 600; }
.doc-progress .small { margin: 6px 0 0; }
.binds a { font-family: var(--mono); font-size: 13px; }

/* EN | PT: Google's website translator, loaded on request; its banner and tooltips hidden so the page does not jump. */
.lang { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin-left: auto; flex: none; }
.lang button { font: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.lang button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.lang button:disabled { cursor: not-allowed; text-decoration: line-through; opacity: 0.6; }
.goog-te-banner-frame, iframe.skiptranslate, .skiptranslate > iframe, #goog-gt-tt, .goog-te-balloon-frame, .goog-tooltip, #gt-el,
.VIpgJd-ZVi9od-ORHb-OEVmcd, .VIpgJd-ZVi9od-aZ2wEe-wOHMyf { display: none !important; }
body { top: 0 !important; position: static !important; }
.goog-text-highlight { background: none !important; box-shadow: none !important; }
footer { color: var(--muted); font-size: 13px; text-align: center; padding: 24px 16px; }

.step-index-head { margin: 12px 0; } .step-index-head p { margin: 0 0 8px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
.filters .sep { width: 1px; height: 20px; background: var(--line); margin: 0 4px; }
.chip { font: inherit; font-size: 13px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: inherit; cursor: pointer; }
.chip.on { border-color: currentColor; font-weight: 600; }
.step-filter { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: inherit; min-width: 200px; flex: 1; }
table.step-table td:first-child { white-space: nowrap; }
.markdown table.step-table { display: table; }
table.step-table tr.group th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); background: var(--surface); padding-top: 10px; }
.chip .n { font-weight: 400; color: var(--muted); margin-left: 2px; }
.step-index { position: relative; }
.step-index-head { position: sticky; top: 56px; z-index: 1; background: var(--bg); padding: 6px 0; }
@media (max-width: 640px) {
  table.step-table .col-machine { display: none; }
  table.step-table td, table.step-table th { padding: 6px 6px; }
  .step-filter { min-width: 0; width: 100%; }
  .step-index-head { position: static; }
}
.state { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 6px; margin-left: 4px; vertical-align: middle; }
.state.done { background: color-mix(in srgb, #1a7f37 18%, transparent); color: #1a7f37; }
.state.open { background: color-mix(in srgb, #6e6e73 18%, transparent); }
.state.blocked { background: color-mix(in srgb, #b26b00 20%, transparent); color: #b26b00; }
tr[data-state="done"] td { opacity: .72; }
a.dec { text-decoration-style: dotted; }
/* A document's metadata (its YAML block), under its title. */
dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 8px 0 22px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; }
dl.meta dt { color: var(--muted); font-family: var(--mono, monospace); font-size: 13px; }
dl.meta dd { margin: 0; }
dl.meta dd p { margin: 0; }
@media (max-width: 640px) { dl.meta { grid-template-columns: 1fr; } dl.meta dd { margin-bottom: 6px; } }

/* Now: a card per party, live over the api's websocket. */
header.top nav a.nav-now { color: var(--accent); font-weight: 650; }
header.top nav a.nav-now::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); margin-right: 5px; vertical-align: 2px; }
.dot { flex: none; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--gone); }
.dot.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.now-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; vertical-align: middle; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); }
.live[data-live="live"] { color: var(--ok); }
.live[data-live="live"] .live-dot { background: var(--ok); animation: live-pulse 2s ease-in-out infinite; }
@keyframes live-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .live[data-live="live"] .live-dot { animation: none; } }
.now-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 16px; margin: 16px 0; }
.now-card { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 16px 18px; scroll-margin-top: 64px; }
.now-card.is-off { opacity: .78; }
.now-card:target { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
.now-card header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.now-card h2 { margin: 0; font-size: 18px; font-family: var(--mono); }
.now-state { color: var(--muted); font-size: 13px; }
.now-where { margin: 2px 0 0 20px; color: var(--muted); font: 12px/1.4 var(--mono); overflow-wrap: anywhere; }
.now-doing { margin: 12px 0 4px; font-size: 19px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.now-doing.idle { font-size: 15px; font-weight: 400; color: var(--muted); font-style: italic; }
.now-doing-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 6px; font-size: 13px; font-weight: 400; color: var(--muted); }
.now-doing-meta .chip { font-family: var(--mono); }
.now-fronts { margin-top: 10px; } .now-fronts .chip { font-family: var(--mono); font-size: 12px; }
.now-sub h3 { margin: 14px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.now-list { list-style: none; padding: 0; margin: 0; font-size: 14px; }
.now-list li { padding: 5px 0; border-bottom: 1px dashed var(--line); overflow-wrap: anywhere; line-height: 1.45; }
.now-list li:last-child { border-bottom: 0; }
.now-list code { font-size: 12px; }
.now-list time, .now-doing-meta time { color: var(--muted); font-size: 12px; white-space: nowrap; }
.now-list time { margin-left: 6px; }
.now-refs { margin-left: 6px; font: 12px var(--mono); }
.now-refs > * + *::before { content: " · "; color: var(--muted); }
.now-who { font: 12px var(--mono); color: var(--muted); }
.now-strip { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.now-strip a { display: flex; gap: 10px; align-items: center; min-width: 0; padding: 8px 12px; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.now-strip a:hover { text-decoration: none; border-color: var(--accent); }
.strip-party { flex: none; font: 600 13px var(--mono); min-width: 6.5em; }
.strip-doing { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 14px; }
.now-strip-wrap h2 a { color: inherit; }
@media (max-width: 560px) { .now-card { padding: 14px; } .now-doing { font-size: 17px; } .strip-party { min-width: 0; } }
`;