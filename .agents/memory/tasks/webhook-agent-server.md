---
name: webhook-agent-server
description: Task record for building the zero-trust GitHub/GitLab webhook server and background AI agent worker.
status: in-progress
---

# Webhook agent server

## Goal / Objective / Detail

- **Goal:** one Express service that receives GitHub and GitLab app webhooks, accepts only
  whitelisted users and orgs, and answers PR/issue comments with an OpenRouter model.
- **Objective:** `npm run dev` boots on SQLite, `PROD=prod` switches to PostgreSQL, the seed
  inserts the OpenRouter provider, unknown users or orgs get 403, accepted events are queued
  in `AgentTask` and answered by the worker, and the test suite passes in CI.
- **Detail:** no repository cloning (REST API diffs only), webhook responds before AI work
  starts, comment line 1 beginning with `@` selects the model.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record, memory index, `.gitignore` | git-server-agents | `plan/webhook-agent-server` | `.agents/`, `.gitignore` | |
| 2 | Project setup | npm project, Prisma schemas, DB switch and seed | git-server-agents | `build/project-setup` | `package.json`, `prisma/`, `scripts/` | |
| 3 | Webhook intake | Express app, routes, controllers, whitelist | git-server-agents | `feat/webhook` | `src/server.js`, `src/app.js`, `src/routes/`, `src/controllers/`, `src/services/whitelist.js` | |
| 4 | Background worker | Polling worker, comment parser, platform and OpenRouter clients | git-server-agents | `feat/worker` | `src/worker.js`, `src/services/` | |
| 5 | Tests and CI | Unit tests and GitHub Actions workflow | git-server-agents | `ci/workflow` | `test/`, `.github/workflows/` | |
| 6 | Release | Changelog and record close-out | git-server-agents | `release/1.0.0` | `wiki/logs/1/0/0/`, `wiki/logs/logs-index.md` | |

## Progress

### Task 1 — plan/webhook-agent-server

- Created this record, the memory index, and a `.gitignore` that excludes `node_modules/`,
  `.env`, the generated `prisma/schema.prisma`, SQLite files and `.agents/plans/`.

### Task 2 — build/project-setup

- `npm init`, runtime deps `express`, `axios`, `@prisma/client`, `dotenv`; dev deps `prisma`,
  `nodemon`. Prisma pinned to 6 (see `decisions/prisma-6.md`).
- `prisma/schema.dev.prisma` (SQLite) and `prisma/schema.prod.prisma` (PostgreSQL) share the
  same models; `scripts/setup-db.js` copies one to the git-ignored `prisma/schema.prisma`.
- `prisma/seed.js` upserts the OpenRouter provider by `displayName` (not unique in the
  schema, so it looks the row up first). Ran twice against SQLite: one row, same id.
- `npm run db:push` and `npx prisma validate` (PostgreSQL schema) both pass.
- Next task depends on: `npm run predev` generating the client before `src/` exists.

### Task 3 — feat/webhook

- `src/app.js` builds the Express app (raw body kept for signature checks), `src/server.js`
  starts it, `src/routes/webhooks.js` mounts `POST /api/webhooks/github` and `/gitlab`.
- `src/controllers/webhookController.js`: verify signature (GitHub HMAC-SHA256, GitLab
  token; required in prod) -> extract identity -> whitelist -> enqueue `AgentTask` -> 200.
- `src/services/whitelistService.js` matches the org on `AppInstallation(platform, orgName)`
  and the user on `Account(type, id)` by immutable platform user id, not login. A stored
  `installationId` must match the payload's. 403 bodies give no reason; the log does.
- `scripts/manage.js` adds and removes whitelisted accounts and orgs by hand.
- Checked with curl on SQLite: signed whitelisted event 200 + queued, bad signature 401,
  unknown user 403, unknown GitLab group 403.
- dotenv 17 logs on load, so every `config()` call passes `quiet: true`.
