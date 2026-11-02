---
name: chat-single-room
description: Task record for the server side of the single-room chat (1.19.0): token usage on answers, stored event data and avatars, agent activity session, /api/chat/summary.
status: in progress
---

# Server support for the single-room chat

## Goal / Objective / Detail

- **Goal:** owen asked on 2026-11-02 to turn the dashboard's Chat page into one selected room with three panes (details, agent work, team chat). Plan: `/mnt/project-files/plans/chat-single-room.md`.
- **Objective:**
  - Answers count input and output tokens from the providers' `usage`, next to cost.
  - `ChatMessage.data` (JSON text) keeps an event's data, such as model, provider, cost and tokens, and `ChatMessage.senderAvatar` keeps the poster's avatar.
  - A message posted to a room's Agent activity session (`sessionId: "activity"`) is always for the agent, with no `@lxagents` prefix. Sessions list it with `activity: true`.
  - `GET /api/chat/summary?room=` gives any room member the room's name and platform, the model and provider the agent would use, key counts (never keys), and usage totals.
- **Detail:**
  - Key counts use `count` queries, so no key is decrypted for the summary.
  - Answers stored before 1.19.0 have no usage. They are counted as answers with unknown usage.
  - Both new columns are nullable, so `db:push` adds them without data loss.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/chat-single-room` | `.agents/` | |
| 2 | Chat summary | Usage, columns, activity session, summary endpoint, tests, docs | git-server-agents | `feat/chat-summary` | `prisma/`, `src/`, `test/`, `wiki/` | |
| 3 | Release | 1.19.0 changelog and version | git-server-agents | `release/1.19.0` | `wiki/logs/`, `package.json` | |
