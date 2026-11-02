---
name: agent-sessions
description: Task record for shared Agent work (queued questions), agent sessions with AGENTS.md and MEMORY.md, and the session tools (server 1.21.0).
status: in progress
---

# Agent sessions, AGENTS.md and MEMORY.md, session tools

## Goal / Objective / Detail

- **Goal:** owen asked on 2026-11-02 that several people can use the same Agent work chat, that the agent has several sessions each with its own `AGENTS.md` and `MEMORY.md`, and that there are tools to create, rename and delete sessions and chats. Plan: `/mnt/project-files/plans/agent-sessions.md`.
- **Objective:** questions in a busy session wait in a queue instead of being refused; `ChatSession.kind` (`agent` | `chat`) with `agentsMd` and `memoryMd`; the agent reads both and gets `list_sessions`, `create_session`, `rename_session`, `delete_session`, `update_memory` and `update_agents_md` in every room; a live `session` event refreshes open pages.
- **Detail:**
  - In repository rooms only writers may change AGENTS.md (it is instructions to the agent); MEMORY.md is notes, shown to the agent as data.
  - The Agent activity session cannot be renamed or deleted; in shared rooms only whoever started a session may delete it.
  - The client side is client 1.17.0 (git-client-agents).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/agent-sessions` | `.agents/` | #106 |
| 2 | Agent sessions | Schema, store, API, queue, prompt, session tools, tests, docs | git-server-agents | `feat/agent-sessions` | `prisma/`, `src/services/chat/`, `src/services/agent/`, `src/controllers/`, `test/`, `wiki/` | #107 |
| 3 | Release | 1.21.0 changelog and version | git-server-agents | `release/1.21.0` | `wiki/logs/`, `package.json` | #108 |
