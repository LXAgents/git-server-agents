---
name: keep-codespaces
description: Task record for keeping the agent's codespace between messages of a chat session or comment thread (1.20.0).
status: done
---

# Keep codespaces between messages

## Goal / Objective / Detail

- **Goal:** owen reported on 2026-11-02 that every new prompt makes the agent create a new codespace, because the last one was deleted when the answer ended. Plan: `/mnt/project-files/plans/keep-codespaces.md`.
- **Objective:** the codespace an answer used stays open for `WORKSPACE_KEEP_MINUTES` (default 60) and the next answer in the same chat session or issue/PR thread reuses it, starting it again if GitHub stopped it.
- **Detail:**
  - The kept codespace is remembered in memory per scope; GitHub's `retention_period_minutes` deletes it anyway if the server restarts.
  - Only an answer that may use the same workspace key, for the same repository, can reuse it.
  - `WORKSPACE_KEEP_MINUTES=0` keeps the old behaviour (delete when the answer ends).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/keep-codespaces` | `.agents/` | #103 |
| 2 | Keep codespaces | Keeper, reuse, restart, scopes, tests, docs | git-server-agents | `feat/keep-codespaces` | `src/services/agent/`, `src/services/platforms/`, `src/services/chat/`, `test/`, `wiki/` | #104 |
| 3 | Release | 1.20.0 changelog and version | git-server-agents | `release/1.20.0` | `wiki/logs/`, `package.json` | #105 |
