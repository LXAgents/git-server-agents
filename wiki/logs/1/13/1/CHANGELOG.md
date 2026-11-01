# 1.13.1 — 2026-11-01

## Changed

- **Agent split by job.** `src/services/agent/` replaces the single 413-line
  `agentService.js` with the flow, prompt, tool loop, key fallback, cost, membership,
  repository tools and a GitHub/GitLab adapter. `agentService.js` still exports the same
  names.
- **Faster answers and org import.** The agent fetches the diff, the thread, the repository,
  memberships and the model in parallel instead of one after another. Org import checks the
  GitHub App installation for every org at once.
- **No controller imports another.** Ownership checks are in `services/access.js` and shared
  views in `services/views.js`.
- **Grouped services.** AI code is under `services/ai/` and GitHub/GitLab code under
  `services/platforms/`.

## Unchanged

- Every endpoint, response, env var and database column. Deploys need no extra step and work
  with git-client-agents 1.12.x.
