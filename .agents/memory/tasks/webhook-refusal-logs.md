---
name: webhook-refusal-logs
description: Task record for logging refused webhooks and checking the setup at start (server 1.12.0).
status: done
---

# Webhook refusal logs

## Goal / Objective / Detail

- **Goal:** a deployment that refuses webhooks says so, instead of staying silent, and the
  owner can read the server's logs on the dashboard.
- **Objective:** every 401 is logged with its reason and names the fix in its body; the server
  warns at start about a missing webhook secret under `PROD=prod` and about an empty database; every log line is stored in a `Log` table and listed to the owner by
  `GET /api/admin/logs` (added by owen during the work).
- **Detail:** owen's PostgreSQL deployment got no answer while SQLite did. `PROD=prod` also
  makes the webhook secret mandatory, and the 401 it caused was never logged.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/webhook-refusal-logs` | `.agents/` | #59 |
| 2 | Refusal logs and setup check | Webhook 401 logs and bodies, start-up check, README | git-server-agents | `feat/webhook-refusal-logs` | `src/controllers/webhookController.js`, `src/setupCheck.js`, `src/server.js`, `test/` | #60 |
| 3 | Stored logs | `Log` table, logService, owner-only `/api/admin/logs` | git-server-agents | `feat/webhook-refusal-logs` | `prisma/`, `src/services/logService.js`, `src/controllers/logController.js` | #60 |
| 4 | Release | Version, changelog | git-server-agents | `release/1.12.0` | `package.json`, `wiki/logs/` | #61 |
