// The site's one stylesheet, served at /static/site.css.
export const CSS = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --surface: #ffffff; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e4e2;
  --accent: #b5246b; --accent-soft: #fbe7f0; --code-bg: #f2f2ef;
  --ok: #1a7f37; --warn: #9a6700; --bad: #c62828; --gone: #8a8a8f;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131315; --surface: #1b1b1e; --fg: #e8e8ea; --muted: #9c9ca3; --line: #2c2c31;
    --accent: #f27bb0; --accent-soft: #3a1c2a; --code-bg: #232327;
    --ok: #4ac26b; --warn: #d29922; --bad: #ff6b6b; --gone: #77777d;
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

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.card .n { font-size: 28px; font-weight: 700; line-height: 1.1; }
.card .l { color: var(--muted); font-size: 14px; }
.card a { color: inherit; }

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

details.tree { margin: 4px 0; }
details.tree > summary { cursor: pointer; padding: 4px 0; font-weight: 600; }
details.tree details.tree { margin-left: 16px; }
details.tree ul { list-style: none; margin: 2px 0 6px 16px; padding: 0; }
details.tree li { padding: 2px 0; }
.frozen { color: var(--muted); font-weight: 400; font-size: 13px; }
footer { color: var(--muted); font-size: 13px; text-align: center; padding: 24px 16px; }
`;
