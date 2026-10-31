---
name: models-and-tokens
description: Task record for per-user, org and repo models and OpenRouter keys, and the @agents trigger (1.6.0).
status: done
---

# Models and tokens per user, org and repo

## Goal / Objective / Detail

- **Goal:** commenters no longer have to name a model. Each user, org and repository can store
  its own model and OpenRouter keys. Requested by the owner on 2026-10-31.
- **Objective:**
  - `@agents` on line 1 uses the stored model: repo, then org, then user, then
    `openrouter/free`. `@vendor/model` still picks a specific model.
  - Keys are tried repo, then org, then user. Repo keys need a collaborator, project member or
    org member. Org keys need an org member.
  - Repositories are imported by their admins (GitHub admin, GitLab Maintainer+) inside
    imported orgs.
- **Detail:**
  - Models are stored per modality (9 modalities); the agent uses `text`.
  - `GET /api/user/models` proxies OpenRouter's live list for the dashboard's picker.
  - Works the same on GitHub and GitLab. Pairs with git-client-agents 1.5.0.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/models-and-tokens` | `.agents/` | |
| 2 | Models and tokens | Schema, parser, model and key fallback, repo and model API, tests, README | git-server-agents | `feat/models-and-tokens` | `prisma/`, `src/`, `test/`, `README.md` | |
| 3 | Release | 1.6.0 changelog and version | git-server-agents | `release/1.6.0` | `wiki/logs/`, `package.json` | |
