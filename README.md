# git-server-agents

A webhook server and AI agent for GitHub and GitLab apps. Anyone can log in with GitHub or
GitLab, and comment on a pull request, merge request or issue in an imported org. The server queues the event, and a
background worker sends the comment to the chosen provider's model (OpenRouter, OpenAI,
Anthropic, DeepSeek or z.ai), together with:

- the diff,
- the earlier conversation,
- any repository files the model asks for.

The answer is posted back as a reply, with a footer naming the model, the provider, the cost, the
loop limit and who asked.
Each user, org and repository brings its own provider keys, and the server holds none.

## Quick start

Needs Node.js 22.22.2+, 24.15+ or 26.

```bash
cp .env.example .env              # see wiki/reference/configuration.md
npm install
npm run db:push
npm run db:seed
npm run dev
```

Then comment on a pull request in an imported org:

```
@lxagents What does this change break?
```

## Wiki

| Page | What it covers |
|---|---|
| [Asking the agent](wiki/guides/asking-the-agent.md) | Triggers, providers and keys, what the agent reads, error codes, and "No answer?" |
| [Setup](wiki/guides/setup.md) | Local setup, the databases, and the GitHub App and GitLab bot permissions |
| [Run with Docker](wiki/guides/docker.md) | The image, its entrypoint, and hosting platforms |
| [Dashboard access](wiki/guides/dashboard-access.md) | OAuth sign-in, the owner and free roles, orgs, repositories, and key order |
| [Configuration](wiki/reference/configuration.md) | Every environment variable |
| [API reference](wiki/reference/api.md) | The admin and user APIs, and the command line |
| [Webhooks and the worker](wiki/reference/webhooks.md) | How a webhook becomes a task and a reply |
| [Code layout](wiki/architecture/code-layout.md) | Where the code lives, and how the agent flows |
| [Release logs](wiki/logs/logs-index.md) | What changed in each version |

The dashboard is [git-client-agents](https://github.com/LXAgents/git-client-agents).
