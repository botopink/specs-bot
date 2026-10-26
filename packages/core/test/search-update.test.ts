import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assignFront, answer,
  appendToSection,
  buildIndex,
  chatSend,
  indexContents,
  loadModel,
  type Model,
  newDoc,
  type Plan,
  setMeta,
  type SearchIndex,
  units,
  Writer,
} from "../src/index.ts";

const FILES: Record<string, string> = {
  "specs/decisions-taken-steps.md":
    "**The next free number is 3.**\n\n## L\n\n| # | Id | Rule in force | Binds | Cell |\n|---|---|---|---|---|\n| 1 | q-1 · (the maintainer, 2026-10-01) | **An opaque type's constructor is private.** | x |  |\n| 2 | q-2 · (the maintainer, 2026-10-02) | **A router reads opaque routes.** | y | router_routes |\n",
  "specs/decisions-pending.md":
    "the next free\nnumber, which is **3**.\n\n## Machine 1\n\n#### q-9 · Does the router narrow?\n- **Measured.** It refuses `for-await-one-source` and reads ranges.\n- **Options.** (a) yes; (b) no.\n- **Recommendation.** (a).\n- **Blocks.** Nothing.\n\n#### q-8 · Is the checker opaque?\n- **Measured.** Opaque routes.\n- **Blocks.** Nothing.\n",
  "specs/decisions-taken.md": "# T\n\n## lang — the language\n\n**Types are nominal.**\n\nAn opaque record hides its fields.\n\nSteps: 1\nBinds: x\n",
  "specs/retired.md": "# R\n\n## Spellings\n\n| Retired | Replaced by | Decisions | Since / note |\n|---|---|---|---|\n| `@Task<T>` | `Async<T>` | 1 | an opaque spelling |\n",
  "specs/milestone/README.md": "---\nmilestone: 1.0.12-beta\n---\n# Specs\n\nThe milestone's router notes.\n",
  "specs/milestone/status.md": "# Status\n\n## Done\n\n- [x] the opaque router\n\n## Open\n\n- [ ] ranges\n",
  "specs/150-rakun/README.md": "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Front 150 — rakun\n\n## Steps\n\nThe router reads opaque routes.\n\n### s1\n\nRouting detail.\n",
  "specs/150-rakun/routes.md": "# Routes\n\n## Ranges\n\nA range of opaque routes.\n",
  "specs/01-checker/README.md": "---\nmilestone: 1.0.5-beta\n---\n# Checker\n\nOld opaque router notes.\n",
  "conversation-chat/machine-2/20261021-1144-rebased-m1-0024.md":
    "---\nfrom: machine-1\nto: machine-2\npurpose: report\nsubject: Rebased the router\nread: [ ]\nin-reply-to:\n---\n\nThe opaque routes are rebased.\n",
};

async function sh(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text());
}

let root: string;
let writer: Writer;
let model: Model;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "specs-bot-index-"));
  for (const [p, t] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  await sh(root, "init", "-q", "-b", "main");
  await sh(root, "config", "user.name", "specs-bot");
  await sh(root, "config", "user.email", "specs-bot@localhost");
  await sh(root, "add", ".");
  await sh(root, "commit", "-qm", "init");
  model = loadModel(root);
  writer = new Writer(root);
});

const AT = new Date(2026, 9, 25, 9, 5);

/** The writes the test lands, one per kind of file the index reads. */
const WRITES: [string, (m: Model) => Plan, string][] = [
  ["doc.append", (m) => appendToSection(m, { ref: "milestone/status", anchor: "open", text: "- [ ] opaque ranges zyxwq" }), "machine-1"],
  ["front.assign", (m) => assignFront(m, { front: "150-rakun", to: "machine-2" }, "maintainer"), "maintainer"],
  ["doc.meta", (m) => setMeta(m, { ref: "150-rakun/README", set: { model: "opus" } }), "maintainer"],
  ["answer", (m) => answer(m, { id: "q-9", rule: "The router narrows opaque ranges.", binds: "z", subject: "lang", at: AT }, "maintainer"), "maintainer"],
  ["chat.send", (m) => chatSend(m, { to: "all", purpose: "report", subject: "Opaque ranges landed", text: "The router narrows zyxwq.", at: AT }, "machine-2"), "machine-2"],
  ["doc.new", (m) => newDoc(m, { ref: "150-rakun/narrowing", text: "# Narrowing\n\n## Opaque ranges\n\nThe router narrows zyxwq routes.\n" }), "machine-1"],
];

/** Every word the units hold, alone and in pairs, through every filter the api passes. */
function sameAnswers(a: SearchIndex, b: SearchIndex, m: Model) {
  const words = [...new Set(units(m).flatMap((u) => `${u.title} ${u.text}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)))].filter((w) => w.length > 1);
  const queries = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`), "for-await-one-source", "opaque rout", "zyxwq"];
  const filters = [{}, { frozen: true }, { version: "1.0.5-beta" }, { machine: "machine-2" }, { front: 150 }, { kinds: ["section" as const, "message" as const] }];
  for (const q of queries) for (const f of filters) expect([q, f, a.search(q, { ...f, limit: 1000 })]).toEqual([q, f, b.search(q, { ...f, limit: 1000 })]);
}

describe("updateIndex", () => {
  test("after each write the updated index is the one a fresh build makes", async () => {
    void model.index;
    for (const [op, plan, party] of WRITES) {
      const r = await writer.apply(model, plan(model), party);
      expect(r.op).toBe(op);
      const fresh = buildIndex(r.model!);
      expect(indexContents(r.model!.index)).toEqual(indexContents(fresh));
      sameAnswers(r.model!.index, fresh, r.model!);
      model = r.model!;
    }
    expect(model.index.search("zyxwq").map((h) => h.key)).toEqual(["milestone/status#open", "m2-0001", "150-rakun/narrowing#opaque-ranges"]);
  });

  test("models never searched add up their files; the first search updates over all of them", async () => {
    void model.index;
    for (const [, plan, party] of WRITES) model = (await writer.apply(model, plan(model), party)).model!;
    expect(indexContents(model.index)).toEqual(indexContents(buildIndex(model)));
  });

  test("the index is taken over, not rebuilt: the model before answers over the new data", async () => {
    const before = model;
    void before.index;
    const r = await writer.apply(model, WRITES[0]![1](model), "machine-1");
    expect(r.model!.index.search("zyxwq")).toHaveLength(1);
    expect(before.index.search("zyxwq")).toHaveLength(1);
  });

  test("a plan made on an older model updates from the last write's", async () => {
    void model.index;
    const old = model;
    model = (await writer.apply(model, WRITES[0]![1](model), "machine-1")).model!;
    void model.index;
    const r = await writer.apply(old, WRITES[3]![1](old), "machine-2");
    expect(indexContents(r.model!.index)).toEqual(indexContents(buildIndex(r.model!)));
  });

  test("a cold model still builds its index on first use", () => {
    expect(model.index.size).toBe(units(model).length);
  });
});
