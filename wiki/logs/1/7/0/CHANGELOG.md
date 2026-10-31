# 1.7.0 — 2026-10-31

Profiles from GitHub and GitLab, an `owner` role, and one platform per session. Deploy with
git-client-agents 1.7.0.

## Added

- **Roles:** `Account.role`, in lower case: `owner` or `member` (the default).
  - Users in `GITHUB_ADMIN_ID` / `GITLAB_ADMIN_ID` become `owner` when they sign in.
  - `/api/admin` opens for owners.
- **Profiles from the platform:** a user's login, display name and avatar are read from GitHub
  (`GET /user/{id}`) or GitLab (`GET /users/{id}`) and cached in memory for 10 minutes.

## Changed

- **One platform per session:** every `/api/admin` request names its platform with
  `X-Platform`, the operator's `ADMIN_TOKEN` included. It lists and changes only that platform's
  users, orgs, repositories and keys.
- **API (breaking):**
  - `/api/user/me` returns `{ platform, id, login, name, avatarUrl, role }`, in place of
    `username` and `isAdmin`.
  - `POST /api/admin/accounts` takes `{ userId, role? }`.
  - User key targets no longer take `platform`.
  - Org owners in views carry `login`, `name` and `avatarUrl`.

## Removed

- `Account.username`. `scripts/clear-usernames.js` empties it before `prisma db push`, so the
  upgrade doesn't stop on a data-loss warning. The Docker entrypoint and `npm run db:push`
  run it.
