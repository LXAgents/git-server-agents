# git-server-agents

A zero-trust webhook server and AI agent for GitHub and GitLab apps. Whitelisted users
comment on a pull request, merge request or issue; the server queues the event, a
background worker sends the diff and the comment to an OpenRouter model, and the answer is
posted back as a reply. Repositories are never cloned: diffs come from the REST APIs.

## How a webhook is handled

1. `POST /api/webhooks/github` or `/gitlab` checks the signature (`X-Hub-Signature-256`
   HMAC or `X-Gitlab-Token`). Bad signature: **401**.
2. The org and the triggering user are looked up in `AppInstallation` and `Account`.
   Either missing: **403**. The apps are public, so nothing is trusted that was not added
   by hand.
3. The payload is stored as a `pending` `AgentTask` and the request returns **200** at once.
4. The worker claims the task, re-checks the whitelist, fetches the diff, calls OpenRouter
   and posts the reply. The task ends as `success`, `skipped` or `failed` (see `errorLog`).

## Choosing a model

If line 1 of the comment is `@vendor/model`, that OpenRouter model is used and the rest of
the comment is the prompt:

```
@nvidia/nemotron-3.5-super-vl:free
Is this migration safe to run twice?
```

Otherwise the whole comment is the prompt and `DEFAULT_MODEL` is used. A first line
without a `/`, such as `@alice`, is treated as a normal mention.

## Setup

Needs Node.js 22.22.2+, 24.15+ or 26 (`.nvmrc` pins 26 LTS, which CI uses: `nvm use`).

```bash
cp .env.example .env              # fill in secrets, see below
npm install
npm run db:push                   # copies the schema for PROD, creates the tables, generates the client
npm run db:seed                   # adds OpenRouter as the default provider
npm run dev                       # server + worker on SQLite, restarts on changes (node --watch)
```

`PROD=prod` switches to PostgreSQL (`prisma/schema.prod.prisma`, `DATABASE_URL`); empty or
`dev` uses SQLite at `prisma/dev.db`. `scripts/setup-db.js` copies the right file to
`prisma/schema.prisma` before `dev`, `start` and `db:push`. Prisma 7 takes the connection URL
from `prisma.config.js` and connects through a driver adapter (`libsql` or `pg`), picked
the same way in `src/db.js`.

| Variable | Purpose |
|---|---|
| `PROD` | `prod` for PostgreSQL, otherwise SQLite |
| `DATABASE_URL` | PostgreSQL connection string (prod) |
| `GITHUB_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET` | Webhook authenticity; required in prod |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | Mint installation tokens to read diffs and post comments |
| `GITLAB_TOKEN`, `GITLAB_API_URL` | Bot token (api scope) and API base for GitLab |
| `ENCRYPTION_KEY` | 32-byte key for stored API keys (`node scripts/manage.js new-encryption-key`) |
| `DEFAULT_MODEL` | Model when the comment names none (default `openrouter/auto`) |
| `WORKER_INLINE`, `WORKER_POLL_MS` | Run the worker in the server process, and its poll interval |
| `ADMIN_TOKEN` | Operator token for `/api/admin`; unset closes the admin API |
| `CORS_ORIGINS` | Origins allowed to call the APIs, e.g. the dashboard (default `http://localhost:5173`) |

## Run with Docker

The root `Dockerfile` builds one image with the server and the worker. It needs no build
arguments. Every setting is an environment variable from the table above, and it listens on
`PORT` (default 3000), so it runs on any platform that deploys a Dockerfile (Render, Railway,
Fly.io, Cloud Run, Koyeb and others).

```bash
docker build -t git-server-agents .
docker run -p 3000:3000 --env-file .env git-server-agents
```

On every start, `docker-entrypoint.sh` does the following, then starts the server:

1. Picks the schema for `PROD`.
2. Generates the Prisma client.
3. Runs `prisma db push`, which creates or updates the tables. It stops instead of dropping data.
4. Seeds OpenRouter.

So an empty database is ready on first boot, with no shell needed. `/health` drives the
container health check.

- **Use PostgreSQL on a platform.** Most platforms wipe the container's disk on every deploy,
  which would erase a SQLite file. Set `PROD=prod` and `DATABASE_URL` to the platform's managed
  PostgreSQL. To keep SQLite anyway, mount a persistent volume at `/app/prisma`.
- **Set at least these:**
  - `ENCRYPTION_KEY` and `ADMIN_TOKEN`.
  - The webhook secrets. They are required when `PROD=prod`.
  - The GitHub App or GitLab credentials.
  - `CORS_ORIGINS`, set to the dashboard's public URL.
- **Whitelist users from the dashboard**, or with the CLI in the running container:
  `docker exec <container> node scripts/manage.js list`. Platforms offer the same through their
  shell or console.
- **To split the worker out,** run a second service from the same image with the command
  `node src/worker.js`, and set `WORKER_INLINE=false` on the web service.

## Whitelisting and API keys

Users are whitelisted only by the operator. Orgs are created only by **import**: a
whitelisted user who owns the org on the platform imports it from the dashboard or the
user API. Roles are never stored; ownership is asked of GitHub or GitLab on every org change.

| Who | How they authenticate | What they can do |
|---|---|---|
| Operator | `Authorization: Bearer $ADMIN_TOKEN` on `/api/admin` | Whitelist and remove users; list and delete orgs; add and delete any key |
| Whitelisted user | `X-Platform: github\|gitlab` + `Authorization: Bearer <personal access token>` on `/api/user` | Manage their own keys; import orgs they own; manage keys of orgs they own |

An org owner is GitHub org role `admin` (or the user's own account), or GitLab access
level Owner (50) on the top-level group. A GitHub token needs `read:org`; a GitLab token
needs `read_api`. The token is used for the request and never stored. On GitHub an org can
be imported only once the App is installed on it.

For an OpenRouter call the worker tries every active key in order: the commenting user's
keys, then the org's keys, each by `priority` (highest first). When a key fails with 401,
402, 403, 429, 5xx, a timeout or a network error, the next key is tried; 400 and 404 stop at
once because every key would fail the same way.

### Admin API (`/api/admin`)

| Method | Path | Body |
|---|---|---|
| GET | `/accounts` | |
| POST | `/accounts` | `{ platform, userId, username }` |
| DELETE | `/accounts/:platform/:userId` | (also removes orgs the user imported, and their keys) |
| GET | `/orgs` | |
| DELETE | `/orgs/:id` | |
| GET | `/keys` | |
| POST | `/keys` | `{ target: "user", platform, userId, apiKey, priority? }` or `{ target: "org", appInstallationId, apiKey, priority? }` |
| DELETE | `/keys/:id` | |

### User API (`/api/user`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | The signed-in user |
| GET, POST | `/keys` | Own keys; POST `{ apiKey, priority? }` |
| DELETE | `/keys/:keyId` | Own keys only |
| GET | `/orgs` | Imported orgs the user owns now |
| GET | `/orgs/importable` | Orgs the user owns on the platform, with `importable` and `reason` |
| POST | `/orgs/import` | `{ orgName }`; owner only |
| DELETE | `/orgs/:id` | Owner only |
| GET, POST | `/orgs/:id/keys` | Owner only; POST `{ apiKey, priority? }` |
| DELETE | `/orgs/:id/keys/:keyId` | Owner only |

Keys are returned with their last four characters only. Errors are JSON `{ "error": "..." }`
with 400, 401, 403, 404 or 409.

### Command line (on the server host)

```bash
node scripts/manage.js add-account github <userId> <login>     # whitelist a user, by platform id
node scripts/manage.js add-key github <userId> sk-or-... 10      # a user's key
node scripts/manage.js add-org-key <orgName> sk-or-... 5 --platform github
node scripts/manage.js list
```

`add-org` is still there for bootstrapping on the server host, where database access
already grants everything; everyone else imports orgs.

## Layout

```
prisma/          schema.dev.prisma, schema.prod.prisma, seed.js (config: prisma.config.js)
scripts/         setup-db.js, manage.js
Dockerfile       production image; docker-entrypoint.sh prepares the database on start
src/server.js    entry point (server + inline worker)
src/worker.js    queue worker (`npm run worker` to run alone)
src/routes/      webhook, admin and user routes
src/controllers/ webhook, admin and user controllers
src/middleware/  admin token, platform-token sign-in, CORS
src/services/    signature, identity, whitelist, task, comment parser, GitHub, GitLab,
                 platform roles, OpenRouter, key, key store and crypto services
test/            node:test suites (`npm test`)
```
