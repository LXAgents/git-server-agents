---
name: oauth-sign-in
description: Task record for client ID and secret sign-in, admin user IDs and the renamed GitHub variables (1.3.0).
status: done
---

# Client ID and secret sign-in

## Goal / Objective / Detail

- **Goal:** configure the platforms with `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`, as the owner asked on 2026-10-31.
- **Objective:** users sign in to the dashboard with GitHub or GitLab OAuth instead of pasting a
  personal access token. The GitHub App is identified by its client ID, which GitHub accepts as
  the JWT issuer, and its key moves to `GITHUB_PRIVATE_KEY`.
- **Detail:** `/api/auth/:platform/start` checks the dashboard redirect against `CORS_ORIGINS`
  and signs a 10-minute `state`. `/api/auth/:platform/callback` swaps the code for a token and
  returns it in the URL fragment. The token is then used like a personal access token, so the
  whitelist and live owner checks are unchanged. `GITLAB_TOKEN` stays for the bot, because GitLab
  has no app-only OAuth token. `PUBLIC_URL` builds the callback URL.
- **Admin users:** a signed-in user whose numeric ID is in `GITHUB_ADMIN_ID` or `GITLAB_ADMIN_ID`
  opens `/api/admin` with their own token, is whitelisted on first sign-in, and gets
  `isAdmin: true` from `/api/user/me`. IDs, not logins, because logins can be renamed and reused.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/oauth-sign-in` | `.agents/` | #23 |
| 2 | OAuth sign-in | Auth routes, admin IDs, renamed variables, tests, docs | git-server-agents | `feat/oauth-sign-in` | `src/`, `test/`, README, `.env.example` | #24 |
| 3 | Release | 1.3.0 changelog and version | git-server-agents | `release/1.3.0` | `wiki/logs/`, `package.json` | #25 |
