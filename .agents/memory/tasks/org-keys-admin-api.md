---
name: org-keys-admin-api
description: Task record for org-level API keys, runtime key fallback and the admin REST API (1.1.0).
status: done
---

# Org keys, key fallback and admin API

## Goal / Objective / Detail

- **Goal:** let an organization own OpenRouter keys, keep answering when one key is
  exhausted, and manage the whitelist over HTTP for the new `git-client-agents` dashboard.
- **Objective:** `AccountKey` can point at an `AppInstallation`; `manage.js add-org-key`
  works; the worker tries every active key (user first, then org) before failing; CRUD
  endpoints under `/api/admin` answer 401 without the `ADMIN_TOKEN`; tests pass on SQLite
  and PostgreSQL.
- **Added scope (2026-10-31):** orgs are created by import only, by a whitelisted user who
  owns the org on the platform; roles are never stored and are checked live against the
  GitHub/GitLab API with the user's own token on every org change; users manage their own
  keys freely.
- **Detail:** the requested schema files are the `.prisma` files; existing 1.0.0 rows stay
  valid (new columns are nullable).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/org-keys-admin-api` | `.agents/` | #7 |
| 2 | Org keys | Schema relation and `add-org-key` | git-server-agents | `feat/org-key` | `prisma/`, `scripts/manage.js` | #8 |
| 3 | Key fallback | `getProviderKeys` and the retry loop | git-server-agents | `feat/key-fallback` | `src/services/keyService.js`, `src/services/agentService.js` | #9 |
| 4 | Platform auth | User identity and owner checks via the platform API | git-server-agents | `feat/platform-auth` | `src/services/platformService.js`, `src/middleware/userAuth.js` | #10 |
| 5 | Admin API | Operator routes behind `ADMIN_TOKEN` (no org creation) | git-server-agents | `feat/admin-api` | `src/routes/admin.js`, `src/controllers/adminController.js`, `src/middleware/adminAuth.js`, `src/app.js` | #11 |
| 6 | User API | Own keys, org import, org keys with live owner checks | git-server-agents | `feat/user-api` | `src/routes/user.js`, `src/controllers/userController.js` | #12 |
| 7 | Release | Changelog, README, close-out | git-server-agents | `release/1.1.0` | `wiki/logs/1/1/0/`, `README.md` | #13 |

## Progress

### Task 1 — plan/org-keys-admin-api

- Created this record. The 1.0.0 record (`webhook-agent-server.md`) is closed and unchanged.

### Task 2 — feat/org-key

- Both `.prisma` schemas: `AccountKey.accountType` / `accountId` are optional, new optional
  `appInstallationId` relation to `AppInstallation` (cascade delete, indexed), back-relation
  `AppInstallation.keys`. Files were run through `prisma format`, which realigned columns.
- `scripts/manage.js add-org-key <orgName> <apiKey> [priority] [provider] [--platform]`;
  `list` shows whether a key belongs to a user or an org. Key creation shared by both commands.
- `db:push` on SQLite applies cleanly over 1.0.0 data; 26 existing tests still pass.

### Task 3 — feat/key-fallback

- `keyService.getProviderKeys(providerName, account, appInstallation)` replaces
  `getProviderKey`: all active decrypted keys, user's first then the org's, each by
  priority desc. A row that fails to decrypt is logged and skipped.
- `agentService.chatWithFallback` tries each key in turn and logs
  `<owner> key <id> failed (<status>), falling back to next...`; the last error is thrown
  when all fail. 400/404 stop at once (they fail identically on every key).
- Behaviour change: the 1.0.0 fallback to the org owner's personal keys is gone.
- Tests: ordering, inactive and unreadable rows, fallback on 401/402/429/5xx and network
  errors, last-error rethrow, no fallback on 400. 34 tests pass on SQLite.

### Task 4 — feat/platform-auth

- `src/services/platformService.js` calls GitHub/GitLab with the user's own token:
  `getUser`, `listOwnedOrgs` (GitHub memberships with role `admin`; GitLab top-level
  groups at access level 50; plus the personal namespace), `isOwner` (live, per call),
  and `findGithubInstallation` (App JWT, `/orgs|users/:name/installation`).
- `src/middleware/userAuth.js`: `X-Platform` + `Authorization: Bearer <token>` → platform
  user → whitelisted `Account`, else 400/401/403. The token is used per request, never stored.
- `src/errors.js` `HttpError` for client-safe errors; the app only logs 5xx now.
- `test/helpers/mockPlatform.js` fakes both APIs; 40 tests pass.

### Task 5 — feat/admin-api

- `src/routes/admin.js` at `/api/admin`, behind `src/middleware/adminAuth.js` (constant-time
  compare against `ADMIN_TOKEN`, bare or `Bearer`; unset means closed; else 401).
- Accounts `GET/POST/DELETE`, orgs `GET/DELETE` (no POST: import only), keys
  `GET/POST/DELETE` with `target: user|org`. Key views carry `last4`, never the key.
- `src/services/keyStore.js` shared key create/list/delete; `src/middleware/cors.js` with
  `CORS_ORIGINS` (default `http://localhost:5173`); Prisma P2025/P2002/P2003 map to
  404/409/400 in the app error handler.
- 45 tests pass on SQLite.

### Task 6 — feat/user-api

- `src/routes/user.js` at `/api/user` behind `userAuth`: `GET /me`; own keys
  `GET/POST/DELETE /keys`; `GET /orgs` (imported orgs the caller owns now),
  `GET /orgs/importable` (owned orgs with `importable` and `reason`),
  `POST /orgs/import`, `DELETE /orgs/:id`; org keys `GET/POST/DELETE /orgs/:id/keys`.
- Import is the only way an org is created: the caller must own it on the platform; on
  GitHub the App must be installed (its installation id is stored). The canonical name
  comes from the platform.
- Every org route re-asks the platform whether the caller owns the org; an org on another
  platform answers 404.
- 51 tests pass on SQLite and on PostgreSQL 16.

### Task 7 — release/1.1.0

- Version 1.1.0 (minor: new features, nullable schema change). `package.json` and the lock
  file bumped; `wiki/logs/1/1/0/CHANGELOG.md` and the log index added; README documents both
  APIs, the key order and the CLI. PR column filled. Record closed.
