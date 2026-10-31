---
name: webhook-refusal-logs
description: Task record for logging refused webhooks and checking the setup at start (server 1.11.2).
status: in-progress
---

# Webhook refusal logs

## Goal / Objective / Detail

- **Goal:** a deployment that refuses webhooks says so, instead of staying silent.
- **Objective:** every 401 is logged with its reason and names the fix in its body; the server
  warns at start about a missing webhook secret under `PROD=prod` and about an empty database.
- **Detail:** owen's PostgreSQL deployment got no answer while SQLite did. `PROD=prod` also
  makes the webhook secret mandatory, and the 401 it caused was never logged.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/webhook-refusal-logs` | `.agents/` | |
| 2 | Refusal logs and setup check | Webhook 401 logs and bodies, start-up check, README | git-server-agents | `feat/webhook-refusal-logs` | `src/controllers/webhookController.js`, `src/setupCheck.js`, `src/server.js`, `test/` | |
| 3 | Release | Version, changelog | git-server-agents | `release/1.11.2` | `package.json`, `wiki/logs/` | |
