---
name: sonar-log-injection
description: Task record for the SonarCloud log-injection finding on the server (1.4.2).
status: done
---

# Log injection fix

## Goal / Objective / Detail

- **Goal:** clear the SonarCloud "Log Injection" finding in `webhookController.js`, which the
  owner reported on 2026-10-31.
- **Objective:** request-derived values are written to the log on one line, with no control
  characters, through a `logSafe()` helper.
- **Detail:**
  - The helper covers the webhook warning, the agent warnings that name users, orgs and models,
    and the worker lines that name the event.
  - Values are capped at 200 characters.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/sonar-log-injection` | `.agents/` | #32 |
| 2 | Log injection | `logSafe()` and its uses, tests | git-server-agents | `fix/sonar-log-injection` | `src/`, `test/` | #33 |
| 3 | Release | 1.4.2 changelog and version | git-server-agents | `release/1.4.2` | `wiki/logs/`, `package.json` | #34 |
