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

```bash
cp .env.example .env              # fill in secrets, see below
npm install
npm run db:push                   # copies the schema for PROD and creates the tables
npm run db:seed                   # adds OpenRouter as the default provider
npm run dev                       # server + worker on SQLite, with nodemon
```

`PROD=prod` switches to PostgreSQL (`prisma/schema.prod.prisma`, `DATABASE_URL`); empty or
`dev` uses SQLite at `prisma/dev.db`. `scripts/setup-db.js` copies the right file to
`prisma/schema.prisma` before `dev`, `start` and `db:push`.

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

## Whitelisting

```bash
# a user, by platform user id (not login, which can be renamed and reclaimed)
node scripts/manage.js add-account github <userId> <login>
# an org, owned by an account; the GitHub installation id is optional but pins it
node scripts/manage.js add-org github <org> <ownerUserId> <installationId>
# an OpenRouter key for an account (stored encrypted)
node scripts/manage.js add-key github <userId> sk-or-... 10
node scripts/manage.js list
```

For an OpenRouter key the worker tries the commenting user's keys first, then the org
owner's, highest `priority` first.

## Layout

```
prisma/          schema.dev.prisma, schema.prod.prisma, seed.js
scripts/         setup-db.js, manage.js
src/server.js    entry point (server + inline worker)
src/worker.js    queue worker (`npm run worker` to run alone)
src/routes/      webhook routes
src/controllers/ webhook controller
src/services/    signature, identity, whitelist, task, comment parser, GitHub, GitLab,
                 OpenRouter, key and crypto services
test/            node:test suites (`npm test`)
```
