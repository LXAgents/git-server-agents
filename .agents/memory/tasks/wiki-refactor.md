---
name: wiki-refactor
description: Task record for moving the server's human documentation from README.md into wiki/ pages and routing them from .agents/index (docs only, no release).
status: done
---

# Wiki refactor

## Goal / Objective / Detail

- **Goal:** the README is an overview, and each fact lives once, in `wiki/`. owen asked for this on 2026-11-01, following `agents-instruction/creators/information-creator.md`. The plan is `/mnt/project-files/plans/wiki-refactor.md`.
- **Objective:**
  - `wiki/guides/` (asking the agent, setup, docker, dashboard access), `wiki/reference/` (webhooks, API, configuration) and `wiki/architecture/` (code layout) hold what the 411-line README held.
  - `.agents/index/root-index.md` and `project-wiki-index.md` route `wiki/`, and `memory-index.md` lists every memory file once.
- **Detail:** this is documentation only, so there is no version bump and no new `wiki/logs/` directory.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/wiki-refactor` | `.agents/memory/` | #71 |
| 2 | Wiki | Pages, indexes, README | git-server-agents | `docs/wiki-refactor` | `wiki/`, `.agents/index/`, `README.md` | #72 |

### Task 1 — plan/wiki-refactor

This record was written before the work. Nothing else changed.

### Task 2 — docs/wiki-refactor

- The README went from 411 to 48 lines. Its sections moved into eight pages: `wiki/guides/asking-the-agent.md`, `setup.md`, `docker.md` and `dashboard-access.md`; `wiki/reference/configuration.md`, `api.md` and `webhooks.md`; and `wiki/architecture/code-layout.md`, which gained the agent flow.
- A line-by-line check against the old README found no lost fact. Only headings and "see above" pointers changed.
- `.agents/index/`: `root-index.md`, `project-wiki-index.md`, a rebuilt `memory-index.md`, and a `memory-tasks-index.md` child. Every link resolves.
- Left for memory-creator: `decisions/prisma-6.md` still says Prisma 6, but the server is on Prisma 7.
