# AGENTS.md

Practical orientation for an AI agent working in this repository. `PLAN.md` is the actual spec (in Portuguese,
the maintainer's language for planning prose); this file is conventions and gotchas for getting work done here
without rediscovering them the hard way. Code and spec content stay in English either way.

## What this repo is

specs-bot is the only door to `botopink/specs-data` (the botopink project's specs, decisions and conversation
log): an API server, a CLI, an MCP server, and a read-only site. Agents working on the *language/libraries*
project (`botopink/projects` and its `AGENTS.md`) never read or write `specs-data` directly — only through this
tool. This repo's own tests and scripts, by contrast, build throwaway `specs-data`-shaped fixtures in temp dirs
freely; that's normal and expected here.

## Layout

- `packages/core` — parsers, writers, the search index, `check()` (the conventions as rules), git access.
  Everything else depends on this; most logic lives here, not in api/cli/site.
- `packages/api` — the Hono server: read routes, write routes (`POST /api/write/:op`, one dispatch table —
  `OPS` in `write-routes.ts` mirrors `WRITES` in `packages/cli/src/write.ts`, same op names), sessions/parties,
  push-to-GitHub (`push.ts`), realtime events.
- `packages/cli` — the `specs-bot` CLI and its MCP server (`mcp.ts`). A write command's CLI flags and its MCP
  tool schema are two views of the same `WRITES[name]` entry (`write.ts`) — add a write once there, wire both.
- `packages/site` — the read-only server-rendered site, built over `packages/core`'s model.
- `scripts/` — one-off *migrations* of `specs-data` itself (`flatten-groups.ts`, `fronts-move.ts`,
  `split-record.ts`, …), each already run once in production and kept for history/reference, not routinely
  re-run. A script like this is the **one** legitimate way `specs-data` is touched outside specs-bot's own write
  path — and even then, only applied to the live clone with the user's `sudo`.

## Working in the code

- **Use Serena first.** `get_symbols_overview` → `find_symbol` (read only the bodies you need) →
  `replace_symbol_body` / `replace_content` for edits. The harness nudges hard toward this; don't fight it with
  grep+Read+Edit loops.
- **Typecheck and test before calling anything done:** `bun run typecheck` (root `tsc -p . --noEmit`), `bun test`
  (root — package-local `bun test` can miss the jsx/tsconfig wiring some site tests need). Run the full suite
  twice if you touched `check.ts` or anything shared; a couple of tests have been individually flaky before.
- **Git workflow observed in this repo's history:** a feature branch, one descriptive commit, `git switch main &&
  git merge --no-ff`, in the project's own voice (no "fix", no bullet-point changelog — a sentence or two of
  *why*, like the existing `git log`). Never `git push` unless asked; the user owns when `origin/main` moves.

## `check()` and the Writer's own safety net

`packages/core/src/write/plan.ts`'s `Writer` runs `check()` before and after every write and **refuses** the
write if it would introduce a finding of severity `error` that wasn't there before ("the write would break
`<code>`"). This means: hardening a `check.ts` rule from `warning` to `error` is not purely additive — audit
every code path that writes new data for a state the new rule would reject, including a write's own **defaults**
(a real bug this way: `answer()`'s auto-created `unfiled` group had no metadata block, so once
`group-meta-missing` became an error, the very first `answer()` with no `--subject` in a fresh repo refused
itself). Grep the whole monorepo for the code you're hardening — core, api, cli, scripts, and every test fixture
that builds a `Store`/`Model` by hand — not just `packages/core/test`.

When a fixture legitimately models an older/incomplete shape on purpose (most test fixtures predate the
decisions-taken metadata block, for instance), prefer narrowing the *assertion* (filter to the finding's `about`,
or exclude one known/expected code with a one-line comment why) over rewriting the fixture — unless the fixture
IS what the test is about, in which case fix the fixture to match current reality.

## The decisions-taken/ metadata block

As of 2026-11-04 (`decisions-meta-refactor`), every `specs/decisions-taken/<slug>.md` opens with a YAML block
before its H1 (`packages/core/src/decisions/meta.ts`): `scope`/`terms`/`related`/`open` written by hand,
`binds`/`retired`/`first-step`/`last-step`/`in-force`/`superseded` derived from the group's own rows and
`retired.md`, kept current by every write that touches a group (`keepMeta` in `write/decisions.ts`) and checked
for staleness by `check.ts`. Edit the hand-written keys with `specs-bot group-meta <slug> --scope/--terms/
--related/--open`; a new group opens with one from birth (`subject-new` requires `--scope`). A superseded row in
the compact layout is exactly `Overtaken by N` / `Replaced by N` / `Reversed by N` — the text as decided lives in
`specs-data`'s git history, not in the file (decision 1108 is what permits this; it amends 730's "a row is never
edited").

## Deploying

```
bun run build:server && sudo install -m 755 dist/specs-bot-server /usr/local/lib/specs-bot/ && sudo systemctl restart specs-bot
```

This needs `sudo` — write it as a script and ask the user to run it (`! <command>` in the session runs it with
their own shell), the same for anything else that needs root or the `specs-bot` OS user. Commands run as
`specs-bot` must `cd /` first; it cannot read `/home`. Push state (ahead/behind GitHub, last error) is in
`/api/health`. **A GitHub-side SSH incident** (check `https://www.githubstatus.com/api/v2/incidents/unresolved.json`)
causes `Permission denied (publickey)` even with a correctly configured deploy key, and clears on its own in
minutes; it is not a local misconfiguration, and the service retries the push every 60s on its own — nothing is
lost while it clears.

## Parties and sessions

A write needs a party (`maintainer`, `machine-1`, `machine-2`); one session holds a given party at a time
(`specs-bot as <party>`), refused with "in use by another session" otherwise, released by `specs-bot logout` or
30 minutes of silence. Before asking the user to free a party, check `GET /api/now` — it names which session
holds it and what it last did.

## Where the live, fast-moving state lives

This file is for stable conventions. What a specific migration or task has actually done, and what's still
pending, lives in Claude Code's own persistent memory for this project
(`~/.claude/projects/-home-ericfillipe-develop-specs-bot/memory/`, indexed in `MEMORY.md`) — read it at the start
of a session, and update it rather than this file when the news is "what happened," not "how this repo works."
