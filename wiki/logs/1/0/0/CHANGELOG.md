# 1.0.0 — 2026-10-31

First release: a zero-trust GitHub/GitLab webhook server that answers comments with OpenRouter.

## Added

- `POST /api/webhooks/github` and `/api/webhooks/gitlab`, with signature checks and a
  manual user/org whitelist that answers 403 for anything not in the database.
- `AgentTask` queue and a background worker that fetches diffs over REST, calls
  OpenRouter and posts the reply.
- `@vendor/model` first-line model selection with a `DEFAULT_MODEL` fallback.
- Prisma schemas for SQLite (dev) and PostgreSQL (prod), switched by `PROD`, and a seed
  that adds the OpenRouter provider.
- `scripts/manage.js` for whitelisting accounts, orgs and encrypted API keys.
- `node:test` suites and a CI workflow on both databases.

## Security

- API keys are stored AES-256-GCM encrypted; `ENCRYPTION_KEY` must be set to add or use them.
- Unsigned webhooks are rejected when `PROD=prod`.

Readers need to do nothing; this is the first version.
