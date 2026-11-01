# Code layout

```
prisma/          schema.dev.prisma, schema.prod.prisma, seed.js (config: prisma.config.js)
scripts/         setup-db.js, manage.js
Dockerfile       production image; docker-entrypoint.sh prepares the database on start
src/server.js    entry point (server + inline worker)
src/worker.js    queue worker (`npm run worker` to run alone)
src/routes/      webhook, auth, admin and user routes
src/controllers/ webhook, auth, admin, user and repository controllers
src/middleware/  owner and platform-token sign-in, CORS
src/services/    org check, task, comment parser, agent errors, key, key store, repository,
                 access checks, shared views, logs and crypto services
  agent/         the agent: flow (index.js), prompt, tool loop and its round limit, key fallback, cost,
                 membership, repository tools, issue and pull request actions, mention parsing and
                 thread reading, and the GitHub/GitLab adapter
  ai/            providers, llmService and the OpenRouter, OpenAI and Anthropic clients,
                 model settings and live model lists
  platforms/     GitHub and GitLab APIs, platform roles, OAuth, signatures, identity
test/            node:test suites (`npm test`)
```

## The agent

The worker (`src/worker.js`) claims a task and calls `processTask` in `src/services/agent/index.js`. The flow:

1. Parse the trigger (`commentParser.js`) and check the org again (`whitelistService.js`).
2. Through the platform adapter (`agent/platform.js`): get the token, add the 👀 reaction, and fetch the diff and the thread.
3. In parallel: the repository, org membership, the provider and model (`ai/modelService.js`), repository membership, and write access (`agent/membership.js`). Write access adds the manage tools (`agent/threadActions.js`) to the read tools (`agent/repoTools.js`). Issues, PRs and commits the comment mentions (`agent/references.js`) add the thread-reading tools (`agent/threadReader.js`).
4. The keys for that provider (`keyService.js`), tried in turn (`agent/keyFallback.js`).
5. The tool loop (`agent/conversation.js`) runs as many rounds as the comment asks for (`agent/loopLimit.js`, default 3) and calls `ai/llmService.js`, which routes to the OpenRouter, OpenAI-compatible or Anthropic client.
6. Post the answer with its footer (`agent/prompt.js`, `agent/cost.js`), or an error reply (`agentErrors.js`).

GitHub and GitLab differences live only in `agent/platform.js` and `platforms/`. A new platform call goes into the adapter, never into an `if (platform === 'github')` branch.
