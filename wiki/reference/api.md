# API reference

The owner uses `/api/admin`, and signed-in users use `/api/user`. Both take `X-Platform: github|gitlab` and `Authorization: Bearer <platform token>`; see [dashboard access](../guides/dashboard-access.md). Webhooks are in [webhooks](webhooks.md).

## Admin API (`/api/admin`)

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
| GET | `/providers` | The AI providers, for the dropdown |
| POST | `/keys` | `{ target: "user", userId, apiKey, provider?, priority? }` or `{ target: "org", appInstallationId, apiKey, provider?, priority? }`; `provider` is a slug, default `openrouter` |
| DELETE | `/keys/:id` | |

## User API (`/api/user`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | The signed-in user |
| GET, POST | `/keys` | Own keys; POST `{ apiKey, provider?, priority? }` |
| DELETE | `/keys/:keyId` | Own keys only |
| GET, POST | `/workspace-keys` | Own workspace keys (GitHub only); POST `{ token, provider?, priority? }`, `provider` defaults to `github_codespaces` |
| DELETE | `/workspace-keys/:keyId` | Own workspace keys only |
| GET | `/orgs` | Imported orgs the user owns now |
| GET | `/orgs/importable` | Orgs the user owns on the platform, with `importable` and `reason` |
| POST | `/orgs/import` | `{ orgName }`; owner only |
| DELETE | `/orgs/:id` | Owner only |
| GET, POST | `/orgs/:id/keys` | Owner only; POST `{ apiKey, provider?, priority? }` |
| DELETE | `/orgs/:id/keys/:keyId` | Owner only |
| GET, POST | `/orgs/:id/workspace-keys` | Owner only; POST `{ token, provider?, priority? }` |
| DELETE | `/orgs/:id/workspace-keys/:keyId` | Owner only |
| GET, PUT | `/orgs/:id/models` | Owner only; PUT `{ modality, provider?, model }` |
| GET | `/providers` | The AI providers: `{ id, name, example, keyForModels, reportsCost }` |
| GET | `/models?modality=text&provider=openai` | That provider's live model list (cached 5 minutes per provider and key); `orgId` or `repoId` lists with that org's or repository's key. `provider` defaults to `openrouter`. Other modalities answer 400 for now |
| GET, PUT | `/models/settings` | Own provider and model per modality, returned as `{ text: { provider, model } }`; PUT `{ modality, provider?, model }`, `model: null` clears it |
| GET | `/repos` | Imported repositories the user administers now |
| GET | `/repos/importable` | Repositories the user administers, with `importable` and `reason` |
| POST | `/repos/import` | `{ externalId }` (the platform's repository or project id); admin only, org must be imported |
| DELETE | `/repos/:id` | Admin only |
| GET, POST | `/repos/:id/keys` | Admin only; POST `{ apiKey, provider?, priority? }` |
| DELETE | `/repos/:id/keys/:keyId` | Admin only |
| GET, POST | `/repos/:id/workspace-keys` | Admin only; POST `{ token, provider?, priority? }` |
| DELETE | `/repos/:id/workspace-keys/:keyId` | Admin only |
| GET, PUT | `/repos/:id/models` | Admin only; PUT `{ modality, provider?, model }` |

Modalities are `text`, `image`, `video`, `speech`, `decisions`, `embeddings`, `rerank`,
`transcription` and `audio`. Every one can be stored; the agent uses `text` today. A missing
`provider` means `openrouter`, and the model id is checked against the provider (OpenRouter ids
are `vendor/name`).

Workspace keys are GitHub personal access tokens with the `codespace` scope (plus `repo` for
pushing), used only by the agent's workspace tools. They are stored encrypted like AI keys and
decrypted at each Codespaces call. The agent tries the repository's, then the org's, then the
commenter's own, each by priority; repository keys only for its collaborators and org keys only
for org members.

Keys are returned with their last four characters only. Errors are JSON `{ "error": "..." }`
with 400, 401, 403, 404 or 409.

## Command line (on the server host)

```bash
node scripts/manage.js add-account github <userId> <login>     # add a user before they log in, by platform id
node scripts/manage.js add-key github <userId> sk-or-... 10      # a user's key
node scripts/manage.js add-org-key <orgName> sk-or-... 5 --platform github
node scripts/manage.js list
```

`add-org` is still there for bootstrapping on the server host, where database access
already grants everything; everyone else imports orgs.
