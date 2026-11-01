---
name: code-structure
description: Task record for the behaviour-neutral refactor of git-server-agents (agent split, platform adapter, access and view services, grouped service folders) in 1.13.1.
status: in progress
---

# Code structure refactor

## Goal / Objective / Detail

- **Goal:** the code is easier to change without changing what it does. Asked for by the
  owner on 2026-11-01 ("check first, if we need it then plan and work"). The plan is
  `/mnt/project-files/plans/code-refactor.md`.
- **Objective:**
  - `agentService.js` is split into `src/services/agent/`, with one job per file.
    `agentService.js` stays as a re-export.
  - The GitHub/GitLab branches in the agent move into one platform adapter.
  - No controller imports another controller. Org/repo access checks live in
    `services/access.js`, and org and key views in `services/views.js`.
  - AI files are grouped under `services/ai/` and platform files under `services/platforms/`.
  - Independent network calls in the agent and in org import run in parallel.
- **Detail:** no API, response, env var or schema change. The existing tests pass with only
  their import paths changed.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/code-structure` | `.agents/` | |
| 2 | Refactor | Agent split, adapter, access/views, folders, parallel calls | git-server-agents | `refactor/code-structure` | `src/`, `test/`, `scripts/`, `prisma/` | |
| 3 | Release | 1.13.1 changelog and version | git-server-agents | `release/1.13.1` | `package.json`, `wiki/logs/` | |

The dashboard half (ApiKeys and ModelPicker split) is git-client-agents 1.12.1.

### Task 1 — plan/code-structure

This record was written before the work. Nothing else changed.

### Task 2 — refactor/code-structure

- **Agent:** `src/services/agent/` holds `index.js` (the flow), `prompt.js`, `conversation.js`
  (tool loop and deadline), `keyFallback.js`, `cost.js`, `membership.js`, `repoTools.js`
  and `platform.js`. `platform.js` is the GitHub/GitLab adapter, so neither the flow nor
  repoTools branches on the platform. `agentService.js` re-exports the old names.
- **Parallel calls:** the diff, the thread and the model/key choice are fetched together. The
  repository lookup runs alongside org membership, and the model alongside repo membership.
  Org import checks GitHub installations for all orgs at once.
- **Controllers:** `services/access.js` (`requireOrgOwner(user, id)`,
  `requireRepoAdmin(user, id)`) and `services/views.js` (`orgView(s)`, `nameUserOwners`).
  No controller imports another, and no fake request objects are built.
- **Folders:** `services/ai/` (providers, llmService, the three clients, modelService) and
  `services/platforms/` (GitHub, GitLab, platformService, OAuth, signatures, identity).
- Tests: the same 164 pass on SQLite as on master. Only import paths changed.
