---
name: agent-pickup-and-speed
description: Task record for the eyes reaction on pickup, step logs, parallel tasks and time limits (1.11.0).
status: done
---

# Agent pickup and speed

## Goal / Objective / Detail

- **Goal:** the owner reported on 2026-10-31 that triggers on 1.10.0 still got no answer.
- **Objective:**
  - The agent shows it picked a comment up with an eyes reaction.
  - Every step is logged.
  - Up to 4 tasks run at once.
  - Each model call has 60 s, and a whole answer has 4 minutes.
  - GitHub and GitLab calls time out after 30 s.
- **Added during the work:** open login with GitHub or GitLab, role `free` in place of
  `member`, and a `Cost: … USD` line under the model in every answer.
- **Detail:** a local end-to-end run on PostgreSQL answered. The likely cause is a slow,
  sequential queue with no feedback, or a webhook that never arrives. The new logs tell the two
  apart.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/agent-pickup-and-speed` | `.agents/` | #53 |
| 2 | Pickup and speed | Reaction, logs, concurrency, deadlines, API timeouts | git-server-agents | `feat/agent-pickup-and-speed` | `src/`, `test/`, `README.md` | #54 |
| 3 | Release | 1.11.0 changelog and version | git-server-agents | `release/1.11.0` | `wiki/logs/`, `package.json` | #55 |
