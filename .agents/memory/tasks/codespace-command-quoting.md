---
name: codespace-command-quoting
description: Task record for commands in codespaces running only their first word, fixed by quoting (1.19.2).
status: done
---

# Commands in codespaces ran only their first word

## Goal / Objective / Detail

- **Goal:** owen reported on 2026-11-02 that the agent could not run `npm init -y` (or `npm --version`) in a codespace; npm printed its usage. Plan: `/mnt/project-files/plans/codespace-command-quoting.md`.
- **Objective:** `run_command` delivers the whole command to the codespace's `bash -lc`, however many words, quotes or operators it has.
- **Detail:** ssh joins the arguments after the host with spaces, so the command must reach `gh codespace ssh` as one shell-quoted string, not as a separate argument.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/codespace-command-quoting` | `.agents/` | |
| 2 | Quote the command | `shellQuote`, tests, docs | git-server-agents | `fix/codespace-command-quoting` | `src/services/platforms/`, `test/`, `wiki/` | |
| 3 | Release | 1.19.2 changelog and version | git-server-agents | `release/1.19.2` | `wiki/logs/`, `package.json` | |
