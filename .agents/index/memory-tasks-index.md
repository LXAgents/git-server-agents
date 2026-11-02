---
name: memory-tasks-index
description: Index of .agents/memory/tasks — one row per task record.
---

# Memory Tasks Index

**Scope:** `.agents/memory/tasks/`
**Parent:** [memory-index](memory-index.md)

## Tasks

| File | Purpose |
|---|---|
| [`tasks/agent-actions.md`](../memory/tasks/agent-actions.md) | Task record for the comment-set tool loop limit and the issue and pull request tools (server 1.15.0). |
| [`tasks/agent-context.md`](../memory/tasks/agent-context.md) | Task record for agent chat history, repository file reading and stricter trigger and key rules (1.4.0). |
| [`tasks/agent-error-replies.md`](../memory/tasks/agent-error-replies.md) | Task record for error replies from the agent, refusing personal access tokens, and the scoped package name (1.10.0). |
| [`tasks/agent-pickup-and-speed.md`](../memory/tasks/agent-pickup-and-speed.md) | Task record for the eyes reaction on pickup, step logs, parallel tasks and time limits (1.11.0). |
| [`tasks/agent-read-references.md`](../memory/tasks/agent-read-references.md) | Task record for letting the agent read the issues, pull requests, PR diffs and commits a comment mentions (server 1.16.0). |
| [`tasks/agent-pr-branch.md`](../memory/tasks/agent-pr-branch.md) | Task record for telling the agent its own pull request's branches and letting it read its own PR (server 1.17.0). |
| [`tasks/codespaces-and-chat.md`](../memory/tasks/codespaces-and-chat.md) | Task record for GitHub Codespaces workspace keys and agent tools, and the 3-room real-time chat (server 1.18.0). |
| [`tasks/code-structure.md`](../memory/tasks/code-structure.md) | Task record for the behaviour-neutral refactor of git-server-agents (agent split, platform adapter, access and view services, grouped service folders) in 1.13.1. |
| [`tasks/docker.md`](../memory/tasks/docker.md) | Task record for the git-server-agents Docker image (1.2.0). |
| [`tasks/install-warnings.md`](../memory/tasks/install-warnings.md) | Task record for clearing the npm install warnings in git-server-agents (1.1.2). |
| [`tasks/latest-dependencies.md`](../memory/tasks/latest-dependencies.md) | Task record for moving git-server-agents to the latest dependencies (1.1.1). |
| [`tasks/lxagents-trigger.md`](../memory/tasks/lxagents-trigger.md) | Task record for renaming the comment trigger from the agents word to lxagents (server 1.14.0). |
| [`tasks/models-and-tokens.md`](../memory/tasks/models-and-tokens.md) | Task record for per-user, org and repo models and OpenRouter keys, and the @agents trigger (1.6.0). |
| [`tasks/multi-provider-byok.md`](../memory/tasks/multi-provider-byok.md) | Task record for native multi-provider BYOK support (OpenRouter, OpenAI, Anthropic, DeepSeek, z.ai) with provider + model per user, org and repo (server 1.13.0). |
| [`tasks/oauth-code-exchange.md`](../memory/tasks/oauth-code-exchange.md) | Task record for returning a sealed one-time code instead of the OAuth token in the URL (1.5.0). |
| [`tasks/oauth-sign-in.md`](../memory/tasks/oauth-sign-in.md) | Task record for client ID and secret sign-in, admin user IDs and the renamed GitHub variables (1.3.0). |
| [`tasks/org-keys-admin-api.md`](../memory/tasks/org-keys-admin-api.md) | Task record for org-level API keys, runtime key fallback and the admin REST API (1.1.0). |
| [`tasks/profiles-roles-platform.md`](../memory/tasks/profiles-roles-platform.md) | Task record for platform profiles, the owner role and one platform per session (1.7.0). |
| [`tasks/remove-operator.md`](../memory/tasks/remove-operator.md) | Task record for removing the ADMIN_TOKEN operator sign-in; platform owners cover it. |
| [`tasks/reply-footer-user.md`](../memory/tasks/reply-footer-user.md) | Task record for the User line in the agent's reply footer (1.11.1). |
| [`tasks/single-owner.md`](../memory/tasks/single-owner.md) | Task record for allowing exactly one owner per platform (1.8.0). |
| [`tasks/sonar-fixes.md`](../memory/tasks/sonar-fixes.md) | Task record for the SonarCloud findings on the server (1.4.1). |
| [`tasks/sonar-log-injection.md`](../memory/tasks/sonar-log-injection.md) | Task record for the SonarCloud log-injection finding on the server (1.4.2). |
| [`tasks/chat-log-injection.md`](../memory/tasks/chat-log-injection.md) | Task record for the SonarCloud log-injection finding in the chat stream (1.18.1). |
| [`tasks/chat-single-room.md`](../memory/tasks/chat-single-room.md) | Task record for the server side of the single-room chat (1.19.0): token usage on answers, stored event data and avatars, agent activity session, /api/chat/summary. |
| [`tasks/chat-manage-tools.md`](../memory/tasks/chat-manage-tools.md) | Task record for the issue and pull request tools in chat repository rooms (1.19.1). |
| [`tasks/codespace-command-quoting.md`](../memory/tasks/codespace-command-quoting.md) | Task record for codespace commands running only their first word, fixed by quoting (1.19.2). |
| [`tasks/keep-codespaces.md`](../memory/tasks/keep-codespaces.md) | Task record for keeping the agent's codespace between messages of a chat session or thread (1.20.0). |
| [`tasks/agent-sessions.md`](../memory/tasks/agent-sessions.md) | Task record for shared Agent work, agent sessions with AGENTS.md and MEMORY.md, and session tools (1.21.0). |
| [`tasks/webhook-agent-server.md`](../memory/tasks/webhook-agent-server.md) | Task record for building the zero-trust GitHub/GitLab webhook server and background AI agent worker. |
| [`tasks/webhook-refusal-logs.md`](../memory/tasks/webhook-refusal-logs.md) | Task record for logging refused webhooks and checking the setup at start (server 1.12.0). |
| [`tasks/wiki-refactor.md`](../memory/tasks/wiki-refactor.md) | Task record for moving the server's human documentation from README.md into wiki/ pages and routing them from .agents/index (docs only, no release). |
