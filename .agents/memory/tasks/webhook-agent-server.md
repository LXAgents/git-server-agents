---
name: webhook-agent-server
description: Task record for building the zero-trust GitHub/GitLab webhook server and background AI agent worker.
status: done
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
| 1 | Task record | This record, memory index, `.gitignore` | git-server-agents | `plan/webhook-agent-server` | `.agents/`, `.gitignore` | #1 |
| 2 | Project setup | npm project, Prisma schemas, DB switch and seed | git-server-agents | `build/project-setup` | `package.json`, `prisma/`, `scripts/` | #2 |
| 3 | Webhook intake | Express app, routes, controllers, whitelist | git-server-agents | `feat/webhook` | `src/server.js`, `src/app.js`, `src/routes/`, `src/controllers/`, `src/services/whitelist.js` | #3 |
| 4 | Background worker | Polling worker, comment parser, platform and OpenRouter clients | git-server-agents | `feat/worker` | `src/worker.js`, `src/services/` | #4 |
| 5 | Tests and CI | Unit tests and GitHub Actions workflow | git-server-agents | `ci/workflow` | `test/`, `.github/workflows/` | #5 |
| 6 | Release | Changelog and record close-out | git-server-agents | `release/1.0.0` | `wiki/logs/1/0/0/`, `wiki/logs/logs-index.md` | #6 |

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

### Task 4 — feat/worker

- `src/worker.js` polls pending `AgentTask` rows, claims each with a conditional update so
  parallel workers never double-answer, and stores `success`, `skipped` or `failed`
  (with `errorLog`). It runs inside the server by default, or alone via `npm run worker`.
- `src/services/agentService.js`: normalise the comment -> parse the model line -> recheck
  the whitelist -> fetch the PR diff (GitHub `application/vnd.github.v3.diff` with an App
  installation token, GitLab `/merge_requests/:iid/diffs`) -> pick an OpenRouter key
  (trigger user first, then the org owner) -> call chat completions -> post the reply.
- `@vendor/model` on line 1 selects the model; a line without `/` is treated as a mention.
- Keys are AES-256-GCM encrypted with `ENCRYPTION_KEY`; `scripts/manage.js add-key` stores them.
- Replies carry a hidden marker so the agent never answers its own comments.
- Checked end to end against a local mock of the GitHub API and OpenRouter: JWT verified,
  diff fetched with the diff media type, chosen model and decrypted key sent, reply posted;
  a marked comment and a `pull_request` event were skipped.
- Not done: tasks left in `processing` by a crash are not re-queued automatically.

### Task 5 — ci/workflow

- `test/` holds `node:test` suites for the comment parser, signature checks, identity
  extraction, key encryption, event normalisation, the GitHub App JWT, and an HTTP test of
  the webhook endpoints against the real database (200 + queued, 401, three 403 cases, ping).
- `.github/workflows/ci.yml` runs `db:push`, `db:seed` and `npm test` on SQLite and on a
  PostgreSQL 16 service, for pushes to `master` and every pull request.
- Ran locally on both: 26 tests pass on SQLite and on PostgreSQL 16 (`PROD=prod`).

### Task 6 — release/1.0.0

- Version 1.0.0 (the owner was unavailable, so it was chosen as the first release of a new
  project; `package.json` already carried it from `npm init`).
- Added `wiki/logs/1/0/0/CHANGELOG.md`, `wiki/logs/logs-index.md`, and a README covering
  the flow, model selection, setup, whitelisting and layout.
- Filled the PR column. Record closed.
