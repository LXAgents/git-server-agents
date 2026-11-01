# Dashboard access

Who can sign in, what they may change, and how keys are chosen. The endpoints are in the [API reference](../reference/api.md).

## Signing in

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

For a model call the worker tries every active key for the resolved provider, in order: the repository's keys,
then the org's keys, then the commenting user's keys, each by `priority` (highest first), and
only the groups the commenter may use (see [what the agent reads](asking-the-agent.md#what-the-agent-reads)). When a key fails with 401,
402, 403, 429, 5xx, a timeout or a network error, the next key is tried; 400 and 404 stop at
once because every key would fail the same way.
