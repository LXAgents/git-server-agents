# 1.3.0 — 2026-10-31

Users sign in to the dashboard with GitHub or GitLab, the platform credentials follow the
client ID and secret naming, and named users get admin control.

## Added

- OAuth sign-in for the dashboard:
  - `GET /api/auth/providers` lists the platforms whose client ID and secret are set.
  - `GET /api/auth/:platform/start` checks the dashboard redirect against `CORS_ORIGINS` and
    sends the browser to GitHub or GitLab with a signed, 10-minute state tied to the browser by a
    cookie.
  - `GET /api/auth/:platform/callback` swaps the code for a user token and returns it to the
    dashboard in the URL fragment.
- `GITHUB_CLIENT_SECRET`, `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET` for sign-in.
- `GITHUB_URL`, `GITLAB_URL` and `PUBLIC_URL` for the OAuth endpoints and the callback URL.
- `GITHUB_ADMIN_ID` and `GITLAB_ADMIN_ID`: numeric user IDs, comma-separated. A matching user's own
  token opens `/api/admin`. They are whitelisted on first sign-in, and `/api/user/me` returns
  `isAdmin`.

## Changed

- **Renamed:** `GITHUB_APP_ID` is now `GITHUB_CLIENT_ID`. GitHub accepts the App's client ID
  as the JWT issuer. `GITHUB_APP_PRIVATE_KEY` is now `GITHUB_PRIVATE_KEY`. The old names are no
  longer read.

## Notes

- Register `<PUBLIC_URL>/api/auth/github/callback` on the GitHub App, and give it the
  "Members: read" organization permission. Register `<PUBLIC_URL>/api/auth/gitlab/callback` on a
  GitLab OAuth application with the `read_api` scope.
- `GITLAB_TOKEN` stays for the bot, because GitLab has no app-only OAuth token.
- Admin users are matched by ID, never by login, because a login can be renamed and then claimed
  by someone else.
