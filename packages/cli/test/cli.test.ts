import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectRoot, loadClientConfig, parseDotenv, tokenVar } from "../src/config.ts";
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
    expect(loadClientConfig(deep, {})).toEqual({ api: "http://host:7165/api", token: "abc", root, timeoutMs: 5000, source: join(root, ".env") });
  });

  test("the environment overrides the files", () => {
    const c = loadClientConfig(deep, { SPECS_BOT_API_URL: "http://other/api", SPECS_BOT_TOKEN: "t" });
    expect([c.api, c.token, c.source]).toEqual(["http://other/api", "t", "environment"]);
  });

  test("without SPECS_BOT_API_URL anywhere it says where it belongs", () => {
    expect(() => loadClientConfig(tmpdir(), {})).toThrow("projects repository's .env");
  });
});

describe("several parties on one machine", () => {
  // The host's checkout holds the maintainer's and machine-1's tokens; machine-1 works in a task worktree inside it.
  const checkout = mkdtempSync(join(tmpdir(), "specs-bot-as-"));
  writeFileSync(join(checkout, ".env"), "SPECS_BOT_API_URL=http://host:7165/api\n");
  writeFileSync(join(checkout, ".env.local"), "SPECS_BOT_TOKEN_MAINTAINER=tm\nSPECS_BOT_TOKEN_MACHINE_1=t1\nSPECS_BOT_AS=maintainer\n");
  const task = join(checkout, ".tasks", "meta-m1");
  mkdirSync(join(task, "sub"), { recursive: true });
  writeFileSync(join(task, ".env"), "SPECS_BOT_API_URL=http://host:7165/api\n");
  writeFileSync(join(task, ".env.local"), "SPECS_BOT_AS=machine-1\n");

  test("a party's token variable", () => {
    expect(tokenVar("machine-1")).toBe("SPECS_BOT_TOKEN_MACHINE_1");
    expect(tokenVar("maintainer")).toBe("SPECS_BOT_TOKEN_MAINTAINER");
  });

  test("the checkout acts as its SPECS_BOT_AS; a worktree inside it reads its tokens and picks its own party", () => {
    expect(loadClientConfig(checkout, {})).toMatchObject({ token: "tm", as: "maintainer" });
    expect(loadClientConfig(join(task, "sub"), {})).toMatchObject({ token: "t1", as: "machine-1", source: join(task, ".env") });
  });

  test("--as and the environment override the files", () => {
    expect(loadClientConfig(task, {}, "maintainer")).toMatchObject({ token: "tm", as: "maintainer" });
    expect(loadClientConfig(checkout, { SPECS_BOT_AS: "machine-1" })).toMatchObject({ token: "t1", as: "machine-1" });
  });

  test("a party needs no token, and never gets another party's", () => {
    const c = loadClientConfig(checkout, {}, "machine-2");
    expect(c.as).toBe("machine-2");
    expect(c.token).toBeUndefined();
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
