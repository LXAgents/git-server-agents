# 1.13.0 — 2026-11-01

## Breaking

- **Model settings carry a provider.** `GET` model settings (user, org, repository) and the
  `models` field on org and repository views return `{ text: { provider, model } }` instead of
  `{ text: "vendor/model" }`. Deploy with git-client-agents 1.12.0. Requests stay compatible:
  a missing `provider` means `openrouter`.

## Added

- **Five AI providers:** OpenRouter, OpenAI, Anthropic, DeepSeek and z.ai (GLM), seeded by
  `npm run db:seed`. `GET /api/user/providers` and `GET /api/admin/providers` list them.
- **Strict bring-your-own-key.** The server holds no AI key. Keys are stored per provider for a
  user, an org or a repository (`provider` on every key `POST`), and the agent answers
  `NO_API_KEY`, naming the provider, before calling any model when none may be used.
- **Provider and model per level.** Users, orgs and repositories each store a provider and a
  model per modality (`PUT { modality, provider, model }`). `@agents` resolves repository, org,
  user, then `DEFAULT_PROVIDER` / `DEFAULT_MODEL`.
- **Live model lists per provider.** `GET /api/user/models?modality=text&provider=…` asks the
  provider's own API, with the caller's key (or a managed org's or repository's, via `orgId` /
  `repoId`) where the provider requires one. OpenRouter stays public.
- **One LLM layer** (`llmService`): OpenAI-compatible client for OpenAI, DeepSeek and z.ai,
  and Anthropic through its official SDK, all returning the same reply shape.
- Settings: `DEFAULT_PROVIDER`, `OPENAI_API_URL`, `ANTHROPIC_API_URL`, `DEEPSEEK_API_URL`,
  `ZAI_API_URL`, `MAX_OUTPUT_TOKENS`.
- The reply footer names the provider. Cost is reported by OpenRouter only; other providers
  show `Cost: unknown`.

## Unchanged

- `@vendor/model` on line 1 still means an OpenRouter model.
- Existing keys and model settings are OpenRouter ones; `db push` needs no data-loss flag.
