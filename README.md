# git-server-agents

A webhook server and AI agent for GitHub and GitLab apps. Anyone can log in with GitHub or
GitLab, and comment on a pull request, merge request or issue in an imported org. The server queues the event, and a
background worker sends the comment to an OpenRouter model, together with:

- the diff,
- the earlier conversation,
- any repository files the model asks for.

The answer is posted back as a reply. Repositories are never cloned: diffs, comments and files
all come from the REST APIs.

## How a webhook is handled

1. `POST /api/webhooks/github` or `/gitlab` checks the signature (`X-Hub-Signature-256`
   HMAC or `X-Gitlab-Token`). Bad signature: **401**.
2. Anything other than a new comment whose line 1 is a trigger (see below) answers **200**
   `{ "status": "ignored" }` and is not stored.
3. The org must be imported (`AppInstallation`) for that App installation; otherwise **403**,
   and the agent never acts there. The apps are public, so this is the gate. The commenter
   needs no account: which keys they may use is decided per comment.
4. The payload is stored as a `pending` `AgentTask` and the request returns **200** at once.
   Every webhook is logged with its outcome (`ignored`, `403 <reason>` or `queued task <id>`).
5. The worker claims the task and puts 👀 on the comment, so the commenter sees it was picked
   up. It re-checks the org, then fetches the diff (PRs and MRs only) and the last 30 comments.
   It calls OpenRouter and posts the reply. The task ends as `success`, `skipped` or `failed`
   (see `errorLog`). A failed task also gets an error reply on the thread (see below).
   - Up to `WORKER_CONCURRENCY` (4) comments are answered at once, so a slow one doesn't hold
     up the rest.
   - Each model call has `MODEL_TIMEOUT_MS` (60 s), and a whole answer has `TASK_TIMEOUT_MS`
     (4 minutes, every call, tool and key together). Past that it replies `TIMEOUT`.
   - GitHub and GitLab calls time out after `PLATFORM_TIMEOUT_MS` (30 s).
6. When the worker starts, tasks left in `processing` for over 30 minutes (by a restart or a
   redeploy) go back to `pending`.

## Asking the agent

Start line 1 of the comment with `@agents` or with an OpenRouter model, `@vendor/model`. The
question can follow on the same line or on the next lines:

```
@agents What files do I have under src/services, and what does agentService.js do?
```

```
@openai/gpt-5
Review this diff.
```

- **`@agents`** uses the stored model: the repository's, then the org's, then the commenting
  user's, then `DEFAULT_MODEL` (`openrouter/free`). Models are set in the dashboard or the user
  API, per modality; the agent uses the `text` one.
- **`@vendor/model`** uses that model, whatever is stored.
- A comment that starts any other way gets no answer, and neither does one whose first line is a
  user mention such as `@alice`.

### When the agent can't answer

A trigger never goes unanswered. If anything fails, the agent replies with a code, the HTTP
status when there is one, what happened (OpenRouter's or the platform's own message), whether
retrying helps, and the task id. For a rate limit it gives the time the limit lifts. When
several keys were tried, it lists each key's owner type and status, but never the key itself.
Error replies are left out of the conversation history.

| Code | Status | Meaning | Retry |
|---|---|---|---|
| `NO_QUESTION` | | The trigger asks nothing | Add the question |
| `NO_API_KEY` | | No active OpenRouter key the commenter may use | No: log in and add a key |
| `INVALID_API_KEY` | 401 | The key is invalid, revoked or disabled | No: replace the key |
| `INSUFFICIENT_CREDITS` | 402 | The key's balance has run out | No: add credits, or use a `:free` model |
| `CONTENT_FLAGGED` | 403 | Moderation refused the input | No: rephrase |
| `MODEL_NOT_FOUND` | 404 | The model id is wrong or has no provider | No: fix the id |
| `BAD_REQUEST` | 400 | OpenRouter rejected the request | No: try another model |
| `TIMEOUT` | 408 | A model call took over 60 s, or the answer over 4 minutes | Once, then pick a faster model |
| `RATE_LIMITED` | 429 | The rate limit or the free-model daily limit was hit | After the time given |
| `PROVIDER_UNAVAILABLE` | 502, 503 | The model's provider is down or busy | In a few minutes |
| `PROVIDER_ERROR` | 500 | The model's provider failed | In a few minutes |
| `EMPTY_RESPONSE` | | The model returned no text | Once, or another model |
| `PLATFORM_ERROR` | any | GitHub or GitLab refused a request | In a few minutes; check the App's permissions |
| `INTERNAL_ERROR` | | Anything else; the details are only in the server log | Once, then give the owner the task id |

OpenRouter sometimes answers HTTP 200 with an error in the body. The agent reads the real
status from it.

If no reply appears at all, the event never reached the worker. On GitHub, check the App's
**Advanced → Recent deliveries**: a 401 there is a bad webhook secret, and a 403 for a comment
in an org nobody imported is expected.

- **Conversation:** the last 30 comments on the issue, PR or MR are sent as chat history.
  The agent's own replies count as `assistant`, everyone else as `user` with their `@login`.
  So follow-up questions work.
- **Repository files:** the model gets two tools, `list_files` and `read_file`. They read
  through the GitHub or GitLab API at the PR or MR head commit, or at the default branch for an
  issue.
  - Files are cut at 40,000 characters and the list at 2,000 paths.
  - If the model doesn't support tools, the agent asks again without them. That second request
    includes the file list and any files the question names.
- **Keys: repository, then org, then the user's own.**
  - **Repository keys** are used only when the commenter is a collaborator on the repository
    (GitHub), a member of the project (GitLab), or a member of its org.
  - **Org keys** are used only when the platform confirms the commenter is a member of the org:
    on GitHub through the App's "Members: read" permission, on GitLab through the bot token. On
    a personal account, the commenter must be its owner.
  - **The commenter's own keys** come last.

  If membership can't be confirmed, those keys are skipped. If a key fails, the next is tried.

The GitHub App needs these repository permissions:

- **Contents: read**, for files.
- **Issues: read and write** and **Pull requests: read and write**, for comments and diffs.
- **Metadata: read** (every App has it), to check repository collaborators.
- **Members: read**, an organization permission.

The GitLab bot token needs the `api` scope (or `read_api` plus permission to post notes).

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
| `GITHUB_CLIENT_ID`, `GITHUB_PRIVATE_KEY` | The GitHub App's client ID and private key. They mint installation tokens to read diffs and post comments |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret, for "Continue with GitHub" on the dashboard |
| `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | A GitLab OAuth application, for "Continue with GitLab" on the dashboard |
| `GITLAB_TOKEN`, `GITLAB_API_URL` | Bot token (api scope) and API base for GitLab. GitLab has no app-only OAuth token, so the bot keeps a token |
| `GITHUB_URL`, `GITLAB_URL` | Web addresses for OAuth (default `https://github.com`, and `GITLAB_API_URL` without `/api/v4`). Change them only for GitHub Enterprise or self-managed GitLab |
| `PUBLIC_URL` | This server's public address, used for the OAuth callback URL. Set it behind a proxy or on a platform |
| `ENCRYPTION_KEY` | 32-byte key for stored API keys (`node scripts/manage.js new-encryption-key`) |
| `DEFAULT_MODEL` | What `@agents` uses when no repository, org or user model is set (default `openrouter/free`) |
| `OPENROUTER_API_URL` | Where the model list comes from (default `https://openrouter.ai/api/v1`) |
| `WORKER_INLINE`, `WORKER_POLL_MS` | Run the worker in the server process, and its poll interval |
| `WORKER_CONCURRENCY` | How many comments are answered at once (default 4) |
| `MODEL_TIMEOUT_MS`, `TASK_TIMEOUT_MS` | Limits for one model call (default 60000) and one whole answer (default 240000) |
| `PLATFORM_TIMEOUT_MS` | Limit for each GitHub or GitLab API call (default 30000) |
| `GITHUB_ADMIN_ID`, `GITLAB_ADMIN_ID` | The **one** numeric GitHub or GitLab user ID that owns that platform (empty: no owner). A comma list stops the server at start |
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
  - `ENCRYPTION_KEY`, `GITHUB_ADMIN_ID` and `GITLAB_ADMIN_ID`.
  - The webhook secrets. They are required when `PROD=prod`.
  - The GitHub App or GitLab credentials, including the client IDs and secrets for sign-in.
  - `PUBLIC_URL`, set to the server's public URL.
  - `CORS_ORIGINS`, set to the dashboard's public URL.
- **Users log in with GitHub or GitLab**; the owner sees them on the dashboard's Users page,
  or with the CLI in the running container: `docker exec <container> node scripts/manage.js list`. Platforms offer the same through their
  shell or console.
- **To split the worker out,** run a second service from the same image with the command
  `node src/worker.js`, and set `WORKER_INLINE=false` on the web service.

## Signing in to the dashboard

Users sign in with **Continue with GitHub** or **Continue with GitLab**. A button shows only
when that platform's client ID and secret are set. Personal access tokens are refused with
**401**: tokens starting `ghp_`, `github_pat_` or `glpat-` can't sign in.

1. On the GitHub App, set the callback URL to `<PUBLIC_URL>/api/auth/github/callback`, generate
   a client secret, and give it the **Members: read** organization permission, which the owner
   checks need. On GitLab, create an OAuth application with the `read_api` scope and the
   callback URL `<PUBLIC_URL>/api/auth/gitlab/callback`.
2. Set the client IDs and secrets, `PUBLIC_URL`, and `CORS_ORIGINS` to the dashboard's address.

How it works:

- `GET /api/auth/providers` lists the platforms that are set up.
- `GET /api/auth/:platform/start?redirect=<dashboard URL>` accepts only a redirect whose origin
  is in `CORS_ORIGINS` (never `*`). It sends the browser to the platform with a signed, 10-minute
  `state`, tied to the browser by a cookie.
- `GET /api/auth/:platform/callback` swaps the platform's code for a user token. It sends the
  browser back with `#code=<sealed>`, a one-time code that holds the token encrypted with
  `ENCRYPTION_KEY` and expires after 60 seconds. The token itself never goes into a URL.
- `POST /api/auth/exchange` with `{ "code": "…" }` answers `{ platform, token }`. Each code works
  once. Dashboards older than 1.3.0 expect the token in the fragment and can't use this server's
  OAuth sign-in.

The token is then sent as `Authorization: Bearer`. The server never stores it, and org
ownership is still checked live. There is no separate sign-up: the first login creates the
account, as `free`.

## Users, orgs and API keys

Anyone with a GitHub or GitLab account can log in; the first login creates their account. Orgs
are created only by **import**: a user who owns the org on the platform imports it from the
dashboard or the user API. Org and repository rights are never stored; they are asked of GitHub or GitLab on
every change.

We store only a user's platform, numeric ID and **role**. Their login, display name and avatar
are read from GitHub (`GET /user/{id}`) or GitLab (`GET /users/{id}`) when needed, and kept in
memory for 10 minutes. Roles are lower case: `owner` runs this deployment, everyone else is
`free` (the default). More roles can be added later. Upgrading from 1.10 or earlier:
`scripts/migrate-roles.js` renames stored `member` rows to `free` after `prisma db push` (the
Docker entrypoint and `npm run db:push` run it).

**Each platform has one owner at most:** the user in `GITHUB_ADMIN_ID` (GitHub) or
`GITLAB_ADMIN_ID` (GitLab).
- The database's `owner` role only mirrors that setting. When that user signs in they become
  `owner`, and any other account of the platform still marked `owner` goes back to `free`.
- Until then, such an account already counts as free.
- Nobody can be made owner through the API. To hand over ownership, change the variable and
  restart.

Every `/api/admin` request works on **one platform**, named by `X-Platform`. A GitHub session
lists and changes only GitHub users, orgs, repositories and keys, and a GitLab session only
GitLab ones.

| Who | How they authenticate | What they can do |
|---|---|---|
| Owner | Their own platform token (`X-Platform` + `Authorization`) on `/api/admin`; the one user in `GITHUB_ADMIN_ID` / `GITLAB_ADMIN_ID` | See and remove users; list and delete orgs and repositories; add and delete any key, on their platform |
| Free user (anyone who logs in) | `X-Platform: github\|gitlab` + `Authorization: Bearer <OAuth token>` on `/api/user` | Manage their own keys and model; import orgs they own and manage their keys and model; import repositories they administer and manage their keys and model |

Users are matched by numeric user ID, never by login, because a login can be renamed and then
claimed by someone else. Find an ID at `https://api.github.com/users/<login>` or on the GitLab
profile page. The user in `GITHUB_ADMIN_ID` or `GITLAB_ADMIN_ID` becomes `owner` the
first time they sign in, and stays `owner` while the setting names them. `/api/user/me` returns
`{ platform, id, login, name, avatarUrl, role }`.

Upgrading from 1.6 or earlier: 1.7.0 drops the stored `username` column.
`scripts/clear-usernames.js` empties it before `prisma db push` (the Docker entrypoint and
`npm run db:push` run it), so the push doesn't stop on a data-loss warning.

An org owner is GitHub org role `admin` (or the user's own account), or GitLab access
level Owner (50) on the top-level group. A GitHub token needs `read:org`; a GitLab token
needs `read_api`. The token is used for the request and never stored. On GitHub an org can
be imported only once the App is installed on it.

A repository admin is GitHub repository permission `admin`, or GitLab access level Maintainer
(40) or above on the project. The repository must be in an imported org. Like org ownership,
it is asked of the platform on every change.

For an OpenRouter call the worker tries every active key in order: the repository's keys,
then the org's keys, then the commenting user's keys, each by `priority` (highest first), and
only the groups the commenter may use (see above). When a key fails with 401,
402, 403, 429, 5xx, a timeout or a network error, the next key is tried; 400 and 404 stop at
once because every key would fail the same way.

### Admin API (`/api/admin`)

| Method | Path | Body |
|---|---|---|
| GET | `/accounts` | |
| POST | `/accounts` | `{ userId }` on the session's platform, always as `free`, before they first log in (`role: "owner"` is refused: the owner comes from `GITHUB_ADMIN_ID` / `GITLAB_ADMIN_ID`) |
| DELETE | `/accounts/:platform/:userId` | `:platform` must be the session's; also removes orgs the user imported, and their keys. They can log in again, as a new free user |
| GET | `/orgs` | |
| DELETE | `/orgs/:id` | |
| GET | `/repos` | |
| DELETE | `/repos/:id` | (also removes the repository's keys and model) |
| GET | `/keys` | |
| POST | `/keys` | `{ target: "user", userId, apiKey, priority? }` or `{ target: "org", appInstallationId, apiKey, priority? }` |
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
| GET, PUT | `/orgs/:id/models` | Owner only; PUT `{ modality, model }` |
| GET | `/models?modality=text` | OpenRouter's live model list (cached 5 minutes). Other modalities answer 400 for now |
| GET, PUT | `/models/settings` | Own model per modality; PUT `{ modality, model }`, `model: null` clears it |
| GET | `/repos` | Imported repositories the user administers now |
| GET | `/repos/importable` | Repositories the user administers, with `importable` and `reason` |
| POST | `/repos/import` | `{ externalId }` (the platform's repository or project id); admin only, org must be imported |
| DELETE | `/repos/:id` | Admin only |
| GET, POST | `/repos/:id/keys` | Admin only; POST `{ apiKey, priority? }` |
| DELETE | `/repos/:id/keys/:keyId` | Admin only |
| GET, PUT | `/repos/:id/models` | Admin only; PUT `{ modality, model }` |

Modalities are `text`, `image`, `video`, `speech`, `decisions`, `embeddings`, `rerank`,
`transcription` and `audio`. Every one can be stored; the agent uses `text` today.

Keys are returned with their last four characters only. Errors are JSON `{ "error": "..." }`
with 400, 401, 403, 404 or 409.

### Command line (on the server host)

```bash
node scripts/manage.js add-account github <userId> <login>     # add a user before they log in, by platform id
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
src/routes/      webhook, auth, admin and user routes
src/controllers/ webhook, auth, admin, user and repository controllers
src/middleware/  owner and platform-token sign-in, CORS
src/services/    signature, identity, org check, task, comment parser, agent errors, GitHub, GitLab,
                 platform roles, OAuth, OpenRouter, model, key, key store, repository
                 and crypto services
test/            node:test suites (`npm test`)
```
