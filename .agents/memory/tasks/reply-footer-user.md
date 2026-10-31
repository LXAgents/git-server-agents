---
name: reply-footer-user
description: Task record for the User line in the agent's reply footer (1.11.1).
status: done
---

# Reply footer user line

## Goal / Objective / Detail

- **Goal:** the owner asked on 2026-10-31 for each answer to name who asked.
- **Objective:** the footer gets `User: @username` under Model and Cost, and the reply marker
  becomes `<!-- LXAgents -->` (the owner's follow-up). The old marker is still recognised.
- **Detail:** the login sits in a code span, so nobody is notified. The line stays out of the
  conversation history.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/reply-footer-user` | `.agents/` | #56 |
| 2 | User line | Footer and history stripper, tests, docs | git-server-agents | `feat/reply-footer-user` | `src/`, `test/`, `README.md` | #57 |
| 3 | Release | 1.11.1 changelog and version | git-server-agents | `release/1.11.1` | `wiki/logs/`, `package.json` | #58 |
