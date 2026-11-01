---
name: lxagents-trigger
description: Task record for renaming the comment trigger from the agents word to lxagents (server 1.14.0).
status: done
---

# The trigger becomes `@lxagents`

## Goal / Objective / Detail

- **Goal:** comments start with `@lxagents` to ask the agent. owen asked for this on 2026-11-01. The plan is `/mnt/project-files/plans/lxagents-trigger.md`.
- **Objective:** `parseComment` treats `@lxagents` (any case) on line 1 as the stored-model trigger. `@agents` is an ordinary word.
- **Detail:** this is a breaking change for users. `@vendor/model` is unchanged. The dashboard text change is git-client-agents 1.13.0.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/lxagents-trigger` | `.agents/` | #68 |
| 2 | Trigger rename | Parser, comments, tests, README | git-server-agents | `feat/lxagents-trigger` | `src/`, `test/`, `README.md`, `.env.example` | #69 |
| 3 | Release | 1.14.0 changelog and version | git-server-agents | `release/1.14.0` | `package.json`, `wiki/logs/` | #70 |

### Task 1 — plan/lxagents-trigger

This record was written before the work. Nothing else changed.

### Task 2 — feat/lxagents-trigger

- `commentParser.js`: `TRIGGER = '@lxagents'`, matched without regard to case. `@agents` is no longer a trigger, and a new test pins that.
- Comments, log text, `.env.example` and the README name `@lxagents`.
- Tests: 165 pass on SQLite.

### Task 3 — release/1.14.0

Version 1.14.0, the changelog at `wiki/logs/1/14/0/CHANGELOG.md` and its index row. The PR column is filled in. The dashboard half is git-client-agents 1.13.0.
