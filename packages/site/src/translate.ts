// What the browser's translation (Google's website translator, PT on request) may translate, and what never:
//
// Never translated — marked `translate="no"` + `class="notranslate"`:
// - code: every `pre` and `code` element (fenced blocks of any language, `.bp` examples, inline `code` — the specs put
//   every keyword, type, refusal code, path and identifier in backticks), and a table cell that is code alone;
// - labels the specs use as names, written bare in prose: front and step labels (`150 s31`, `B-162`, `s10`,
//   `144 B-29`), folder names (`04-rakun`, `150-rakun`), question ids (`810-d`, `b162-place-repeat`, `ctr-af`,
//   `166-f`), message ids (`m1-0024`), machines (`machine-1`), versions (`1.0.12-beta`), file names (`main.bp`,
//   `README.md`);
// - the language's keywords that are no English word, written bare: `fn val var pub comptime iter`, the numeric
//   types (`i32 i64 f64 u32 u64 bigint`) and `bool void null`. Measured over the current milestone and the decision
//   files: a keyword used as a keyword is almost always in backticks already; the bare ones that are also English
//   words (`type` 1159 bare against 40 in code, `for`, `from`, `record`, `component`, `case`, `use`, `import`,
//   `opaque`, `async`, `return`, …) are prose — "the return type", "for `x`" (193 times next to code) — and are
//   left to the translator;
// - a block that follows `<!-- notrans -->` (see markdown.ts);
// - anything inside an element already marked, `script` and `style`.
//
// Translated: prose paragraphs, list text, headings' words, table prose, the site's own labels.

const NO = 'translate="no"';

/** The language's keywords that are no English word: safe to keep untranslated wherever they stand bare. */
export const BARE_KEYWORDS = ["fn", "val", "var", "pub", "comptime", "iter", "i32", "i64", "f64", "u32", "u64", "bigint", "bool", "void", "null"];

const LABELS = new RegExp(
  [
    // 150 s31 · 144 B-29 · 135 s1–4 · 105 Conformance
    String.raw`\b\d{1,3} (?:s\d+[a-z]?(?:[–-]\d+)?|B-\d+[a-z0-9]*(?:-[a-z0-9]+)*|Conformance)\b`,
    // B-162, B-29-a
    String.raw`\bB-\d+[a-z0-9]*(?:-[a-z0-9]+)*\b`,
    // s10, s3b
    String.raw`\bs\d+[a-z]?\b`,
    // m1-0024, mt-0031
    String.raw`\b(?:m\d|mt)-\d{4}\b`,
    // b162-place-repeat, ctr-af, impl-b
    String.raw`\b(?:b\d+|ctr|impl)-[a-z0-9]+(?:-[a-z0-9]+)*\b`,
    // 04-rakun, 150-rakun, 810-d, 166-f
    String.raw`\b\d{1,3}-[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b`,
    // machine-1
    String.raw`\bmachine-\d\b`,
    // 1.0.12-beta
    String.raw`\b\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b`,
    // main.bp, README.md, botopink.json
    String.raw`\b[\w.-]+\.(?:bpp?|md|json|zig|ts|erl|wat|snap)\b`,
    // the bare keywords
    String.raw`(?<![\w-])(?:${BARE_KEYWORDS.join("|")})(?![\w-])`,
  ].join("|"),
  "g",
);

/** A text's labels and bare keywords wrapped so the translator leaves them. Runs on HTML text (entities intact). */
export function protectText(text: string): string {
  return text.replace(LABELS, (m) => `<span class="notranslate" ${NO}>${m}</span>`);
}

const SKIP = new Set(["code", "pre", "script", "style", "kbd", "samp", "textarea", "title"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * An HTML page with every `code` / `pre` marked untranslatable, a table cell that is code alone marked too, and the
 * labels in its remaining text wrapped. Text inside an element already marked (or code, script, style) is kept.
 */
export function protectHtml(html: string): string {
  const marked = html
    // A cell that is code alone: the cell itself is not prose.
    .replace(/<(td|th)>(\s*<code>[^<]*<\/code>\s*)<\/\1>/g, `<$1 class="notranslate" ${NO}>$2</$1>`)
    .replace(/<(code|pre)(\s[^>]*)?>/g, (tag, name: string, attrs = "") => {
      if (/\btranslate=/.test(attrs)) return tag;
      const withClass = /\bclass="/.test(attrs) ? attrs.replace(/\bclass="/, 'class="notranslate ') : `${attrs} class="notranslate"`;
      return `<${name}${withClass} ${NO}>`;
    });

  const parts = marked.split(/(<[^>]+>)/);
  // The element names, innermost last, of the untranslatable elements we are inside.
  const stack: string[] = [];
  let inside = 0;
  let out = "";
  for (const part of parts) {
    if (part.startsWith("<")) {
      const m = part.match(/^<(\/)?([a-zA-Z][a-zA-Z0-9-]*)/);
      if (m) {
        const name = m[2]!.toLowerCase();
        if (m[1]) {
          if (inside && stack.at(-1) === name) {
            stack.pop();
            inside--;
          } else if (inside && stack.includes(name)) {
            // Tolerate a missing inner close: unwind to it.
            while (stack.length && stack.at(-1) !== name) stack.pop();
            stack.pop();
            inside = stack.length;
          }
        } else if (!VOID.has(name) && !part.endsWith("/>")) {
          if (inside) {
            stack.push(name);
            inside++;
          } else if (SKIP.has(name) || /\btranslate="no"/.test(part)) {
            stack.push(name);
            inside = 1;
          }
        }
      }
      out += part;
    } else {
      out += inside ? part : protectText(part);
    }
  }
  return out;
}
