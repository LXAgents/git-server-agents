---
name: reply-footer-user
description: Task record for the User line in the agent's reply footer (1.11.1).
status: in-progress
---

# Reply footer user line

## Goal / Objective / Detail

- **Goal:** the owner asked on 2026-10-31 for each answer to name who asked.
- **Objective:** the footer gets `User: @login` under Model and Cost.
- **Detail:** the login sits in a code span, so nobody is notified. The line stays out of the
  conversation history.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/reply-footer-user` | `.agents/` | |
| 2 | User line | Footer and history stripper, tests, docs | git-server-agents | `feat/reply-footer-user` | `src/`, `test/`, `README.md` | |
| 3 | Release | 1.11.1 changelog and version | git-server-agents | `release/1.11.1` | `wiki/logs/`, `package.json` | |
