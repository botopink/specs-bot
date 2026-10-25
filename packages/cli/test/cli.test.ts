import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot, loadClientConfig, parseDotenv } from "../src/config.ts";
import { render, textOf } from "../src/output.ts";

describe("parseDotenv", () => {
  test("reads quoted and unquoted values, drops comments", () => {
    expect(parseDotenv('# c\nA=1\nB="x y"\nexport C=z # note\n\nbad line\n')).toEqual({ A: "1", B: "x y", C: "z" });
  });
});

describe("loadClientConfig", () => {
  const root = mkdtempSync(join(tmpdir(), "specs-bot-cli-"));
  const deep = join(root, ".tasks", "meta-m1", "repo");
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(root, ".env"), "SPECS_BOT_API_URL=http://host:7165/api/\nSPECS_BOT_TIMEOUT_MS=5000\n");
  writeFileSync(join(root, ".env.local"), "SPECS_BOT_TOKEN=abc\n");

  test("finds the projects .env from a task folder below it", () => {
    expect(findProjectRoot(deep)).toBe(root);
    expect(loadClientConfig(deep, {})).toEqual({ api: "http://host:7165/api", token: "abc", timeoutMs: 5000, source: join(root, ".env") });
  });

  test("the environment overrides the files", () => {
    const c = loadClientConfig(deep, { SPECS_BOT_API_URL: "http://other/api", SPECS_BOT_TOKEN: "t" });
    expect([c.api, c.token, c.source]).toEqual(["http://other/api", "t", "environment"]);
  });

  test("without SPECS_BOT_API_URL anywhere it says where it belongs", () => {
    expect(() => loadClientConfig(tmpdir(), {})).toThrow("projects repository's .env");
  });
});

describe("render", () => {
  test("toon is the compact default", () => {
    expect(render({ num: 814, status: "in-force" }, "toon")).toBe("num: 814\nstatus: in-force");
  });

  test("a document's text is printed as it is after its head", () => {
    expect(render({ ref: "a/b", text: "# T\n\nBody.\n" }, "toon")).toBe("ref: a/b\n---\n# T\n\nBody.\n");
  });

  test("text lists records one per line", () => {
    expect(textOf({ hits: [{ kind: "step", key: "814" }] })).toBe("hits:\n  - step · 814");
  });
});
