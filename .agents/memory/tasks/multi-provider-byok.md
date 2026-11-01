---
name: multi-provider-byok
description: Task record for native multi-provider BYOK support (OpenRouter, OpenAI, Anthropic, DeepSeek, z.ai) with provider + model per user, org and repo (server 1.13.0).
status: in progress
---

# Multi-provider BYOK

## Goal / Objective / Detail

- **Goal:** the agent is no longer tied to OpenRouter. Each user, org and repository brings its
  own key for any of five providers and picks the provider and model it wants. Requested by
  the owner on 2026-11-01.
- **Objective:**
  - Providers `openrouter`, `openai`, `anthropic`, `deepseek` and `zai` are seeded and listed
    by `GET /api/user/providers` and `GET /api/admin/providers`.
  - Keys are created per provider; the server has no key of its own (strict BYOK), and the
    agent refuses with `NO_API_KEY` naming the provider before any model call when no allowed
    key exists.
  - `ModelSetting` stores `{ modality, provider, model }`; `resolveModel` returns provider and
    model (repo, org, user, then `DEFAULT_PROVIDER` / `DEFAULT_MODEL`).
  - `GET /api/user/models?modality=text&provider=…` lists that provider's live models, using
    the caller's (or a managed org's or repo's) key where the provider needs one.
  - `llmService` routes completions to OpenRouter, OpenAI, Anthropic, DeepSeek or z.ai and
    returns one shape.
- **Detail:**
  - Schema: `Provider.slug` (optional, unique) and `ModelSetting.provider` (default
    `openrouter`). No new table.
  - `@vendor/model` on line 1 keeps meaning an OpenRouter model.
  - Only OpenRouter reports cost; other answers say `Cost: unknown`.
  - Model settings `GET` returns `{ text: { provider, model } }`; deploy with git-client-agents
    1.12.0.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/multi-provider-byok` | `.agents/` | |
| 2 | Multi-provider BYOK | Schema, seed, providers, LLM layer, keys, models, agent, routes, tests, docs | git-server-agents | `feat/multi-provider-byok` | `prisma/`, `src/`, `test/`, `README.md`, `.env.example` | |
| 3 | Release | 1.13.0 changelog and version | git-server-agents | `release/1.13.0` | `package.json`, `wiki/logs/` | |

The dashboard half (provider dropdowns, provider + model per level) is git-client-agents
1.12.0 and merges after this chain.

### Task 1 — plan/multi-provider-byok

Record written before the work. Nothing else changed.
