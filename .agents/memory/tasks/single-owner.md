---
name: single-owner
description: Task record for allowing exactly one owner per platform (1.8.0).
status: done
---

# One owner per platform

## Goal / Objective / Detail

- **Goal:** the owner asked on 2026-10-31 that there be only one owner.
- **Objective:** the owner of each platform is exactly the one ID in `GITHUB_ADMIN_ID` or
  `GITLAB_ADMIN_ID`, and no other account can hold or gain the `owner` role.
- **Detail:**
  - A comma list stops the server at start.
  - Stale `owner` rows count as members and are demoted.
  - `POST /api/admin/accounts` refuses `owner`.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/single-owner` | `.agents/` | #44 |
| 2 | Single owner | Config check, owner sync, create refusal, tests, docs | git-server-agents | `feat/single-owner` | `src/`, `test/`, `README.md` | #45 |
| 3 | Release | 1.8.0 changelog and version | git-server-agents | `release/1.8.0` | `wiki/logs/`, `package.json` | #46 |
