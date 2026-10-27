import { describe, expect, test } from "bun:test";
import {
  assignFront,
  buildModel,
  check,
  claimFront,
  parseDoc,
  parsePending,
  parseRetired,
  parseSteps,
  parseTaken,
  placeDocs,
  type Plan,
  newFront,
  releaseFront,
  splitMeta,
  WriteError,
} from "../src/index.ts";

const model = buildModel({
  specsDir: "/nowhere",
  steps: parseSteps(""),
  pending: parsePending(""),
  taken: parseTaken(""),
  retired: parseRetired(""),
  tree: placeDocs([
    parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
    parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\npriority: high\n---\n# Front 150\n\nText.\n"),
    parseDoc("150-rakun/04-rakun/track.md", "---\nmilestone: 1.0.12-beta\n---\n# Track\n"),
    parseDoc("163-meta-ci/README.md", "---\nmilestone: 1.0.12-beta\nowner: machine-2\n---\n# Front 163\n"),
    parseDoc("144-checker/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Front 144 — checker\n"),
    parseDoc("144-backends-tooling/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Front 144 — backends\n"),
    parseDoc("01-checker/README.md", "---\nmilestone: 1.0.5-beta\n---\n# Old\n"),
  ]),
  chat: [],
});

const after = (p: Plan) => p.changes[0]!.after;
const metaOf = (p: Plan) => splitMeta(after(p).split("\n")).meta;
function refused(f: () => unknown): WriteError {
  try {
    f();
  } catch (e) {
    if (e instanceof WriteError) return e;
    throw e;
  }
  throw new Error("not refused");
}

describe("claimFront", () => {
  test("a machine takes a free front: its README gets the owner, the rest of the file stays", () => {
    const p = claimFront(model, { front: "150-rakun" }, "machine-1");
    expect([p.op, p.refs, p.message]).toEqual(["front.claim", ["150-rakun"], "spec(1.0.12-beta): 150-rakun: claimed by machine-1"]);
    expect(p.changes[0]!.path).toBe("specs/150-rakun/README.md");
    expect(metaOf(p)).toEqual({ milestone: "1.0.12-beta", owner: "machine-1", priority: "high" });
    expect(after(p).endsWith("# Front 150\n\nText.\n")).toBe(true);
    // A front by its number, when one folder has it.
    expect(claimFront(model, { front: "150" }, "machine-2").changes[0]!.path).toBe("specs/150-rakun/README.md");
  });

  test("refuses a held front, the front one already holds, the maintainer, an ambiguous number, a closed or unknown front", () => {
    expect(refused(() => claimFront(model, { front: "163-meta-ci" }, "machine-1"))).toMatchObject({ code: "conflict", detail: { owner: "machine-2" } });
    expect(refused(() => claimFront(model, { front: "163" }, "machine-2")).message).toContain("already machine-2's");
    expect(refused(() => claimFront(model, { front: "150" }, "maintainer")).code).toBe("forbidden");
    expect(refused(() => claimFront(model, { front: "144" }, "machine-1")).message).toContain("144-backends-tooling, 144-checker");
    expect(refused(() => claimFront(model, { front: "01-checker" }, "machine-1")).code).toBe("frozen");
    expect(refused(() => claimFront(model, { front: "999-nothing" }, "machine-1")).code).toBe("not-found");
  });
});

describe("releaseFront and assignFront", () => {
  test("the owner or the maintainer releases; nobody else", () => {
    expect(metaOf(releaseFront(model, { front: "163-meta-ci" }, "machine-2"))).toEqual({ milestone: "1.0.12-beta" });
    expect(releaseFront(model, { front: "163" }, "maintainer").message).toBe("spec(1.0.12-beta): 163-meta-ci: released by maintainer");
    expect(refused(() => releaseFront(model, { front: "163" }, "machine-1")).code).toBe("forbidden");
    expect(refused(() => releaseFront(model, { front: "150" }, "machine-1")).message).toContain("has no owner");
  });

  test("the maintainer assigns, a free front or a held one; machines don't", () => {
    expect(metaOf(assignFront(model, { front: "150", to: "machine-2" }, "maintainer")).owner).toBe("machine-2");
    expect(assignFront(model, { front: "163", to: "machine-1" }, "maintainer").message).toContain("reassigned from machine-2 to machine-1");
    expect(refused(() => assignFront(model, { front: "150", to: "machine-2" }, "machine-1")).code).toBe("forbidden");
    expect(refused(() => assignFront(model, { front: "150", to: "maintainer" }, "maintainer")).message).toContain("is no machine");
    expect(refused(() => assignFront(model, { front: "163", to: "machine-2" }, "maintainer")).message).toContain("already machine-2's");
  });
});

describe("the owner belongs on the front's README", () => {
  test("documents under a front inherit it; check refuses it anywhere else", () => {
    expect(model.docByRef.get("163-meta-ci/README")!.owner).toBe("machine-2");
    const stray = buildModel({
      ...model,
      tree: placeDocs([
        parseDoc("milestone/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Specs\n"),
        parseDoc("150-rakun/README.md", "---\nmilestone: 1.0.12-beta\n---\n# Front 150\n"),
        parseDoc("150-rakun/04-rakun/track.md", "---\nmilestone: 1.0.12-beta\nowner: machine-1\n---\n# Track\n"),
      ]),
    });
    expect(check(stray).filter((f) => f.code === "doc-owner-outside-front").map((f) => f.about)).toEqual(["150-rakun/04-rakun/track"]);
  });
});

describe("newFront", () => {
  test("opens specs/<NNN-slug>/README.md in the current milestone, free", () => {
    const p = newFront(model, { front: "168-library-check", text: "# Front 168 — library check\n\nWhy.\n" });
    expect(p.op).toBe("front.new");
    expect(p.refs).toEqual(["168-library-check"]);
    expect(p.message).toBe("spec(1.0.12-beta): 168-library-check: front opened");
    expect(p.changes).toEqual([{ path: "specs/168-library-check/README.md", before: null, after: expect.any(String) }]);
    expect(metaOf(p)).toEqual({ milestone: "1.0.12-beta" });
    expect(after(p)).toContain("# Front 168 — library check\n\nWhy.\n");
    // Its own metadata comes along.
    expect(metaOf(newFront(model, { front: "169-x", text: "---\npriority: low\n---\n# X\n" }))).toEqual({ milestone: "1.0.12-beta", priority: "low" });
  });

  test("refuses a used number (any milestone), a bad folder, an owner, a text without a title", () => {
    expect(refused(() => newFront(model, { front: "150-other", text: "# X\n" }))).toMatchObject({ code: "conflict", hint: "the next free number is 164" });
    expect(refused(() => newFront(model, { front: "001-old", text: "# X\n" })).code).toBe("conflict");
    for (const front of ["168", "168-Library", "milestone", "168-a/b", "68-short"]) expect(refused(() => newFront(model, { front, text: "# X\n" })).code).toBe("invalid");
    expect(refused(() => newFront(model, { front: "168-x", text: "---\nowner: machine-1\n---\n# X\n" })).message).toContain("owner");
    expect(refused(() => newFront(model, { front: "168-x", text: "no title\n" })).code).toBe("invalid");
  });
});
