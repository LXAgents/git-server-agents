# 1.1.0 — 2026-10-31

Org-level API keys, runtime key fallback, and REST APIs for the git-client-agents dashboard.

## Added

- `AccountKey.appInstallationId`: a key can belong to an org instead of a user;
  `manage.js add-org-key`.
- The worker tries every active key in turn (user's, then org's, by priority) and falls
  back on 401, 402, 403, 429, 5xx and network errors.
- `/api/admin` behind `ADMIN_TOKEN`: accounts, orgs (list and delete) and keys.
- `/api/user` signed in with the user's own GitHub/GitLab token: own keys, org import,
  org keys. Org ownership is checked live against the platform on every call.
- `CORS_ORIGINS` for the dashboard.

## Changed

- Orgs are created by import only; the APIs offer no way to create one by name.
- `AccountKey.accountType` and `accountId` are optional. Run `npm run db:push` to apply.
- **Behaviour change:** the 1.0.0 fallback to the org owner's personal keys is gone. If an
  org relied on its owner's key, add it to the org with `add-org-key` or the dashboard.

## Security

- Keys are shown with their last four characters only.
- Platform tokens are used per request and never stored; roles are never stored.
