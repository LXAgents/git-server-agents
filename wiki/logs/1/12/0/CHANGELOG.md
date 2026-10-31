# 1.12.0 — 2026-10-31

## Added

- **Stored logs.** Every log line also goes into a new `Log` table, with its level, source
  (webhook, worker, agent, setup, server, app, keys), platform and task. `GET /api/admin/logs`
  lists them to the owner, newest first, with `level`, `source`, `limit` and `before`. The
  owner sees their platform's lines and the server's own. Lines older than
  `LOG_RETENTION_DAYS` (14) are deleted at start and every six hours. `LOG_STORE=false` turns
  storing off.
- **Setup check at start.** The server logs which database it uses. Under `PROD=prod` it warns
  when a GitHub or GitLab App is set up without its webhook secret. It also warns when the
  database has no imported organization.
- README: a "No answer?" checklist.

## Fixed

- **Silent 401s.** With `PROD=prod`, a missing or different webhook secret refused every
  webhook without a log line, so a PostgreSQL deployment looked dead while SQLite answered.
  Every refusal is now logged, and the 401 body names the setting to fix, for example
  "GITHUB_WEBHOOK_SECRET is not set on the server".
