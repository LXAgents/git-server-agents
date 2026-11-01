---
name: codespaces-and-chat
description: Task record for GitHub Codespaces workspace keys and agent tools, and the 3-room real-time chat with progress and token streaming (server 1.18.0).
status: in-progress
---

# Codespaces workspaces and real-time chat

## Goal / Objective / Detail

- **Goal:** the agent can work in a real development environment: start a GitHub Codespace, run commands, commit and push, and show its progress live in a chat with User, Repository and Org rooms. owen asked on 2026-11-01; the plan is `/mnt/project-files/plans/codespaces-and-chat.md`.
- **Objective:** workspace keys (GitHub PATs with the `codespace` scope) per user, org and repo with repo → org → user fallback; `create_workspace`, `exec_command`, `commit_workspace`, `delete_workspace` tools for commenters with write access; `/api/chat` with SSE rooms, stored messages, progress and streamed tokens; the agent answers `@lxagents` in the chat.
- **Detail:** zero trust stays: keys are decrypted at each use and never cached, room access is checked on every request, the tools only touch codespaces created in the same answer and delete them at the end. GitHub only (GitLab has no Codespaces). Nothing existing is removed.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/codespaces-and-chat` | `.agents/` | |
| 2 | Workspace keys | Schema, fallback service, key API | git-server-agents | `feat/workspace-keys` | `prisma/`, `src/services/`, `src/controllers/`, `src/routes/`, `test/` | |
| 3 | Codespaces service | REST calls, `gh codespace ssh`, Dockerfile | git-server-agents | `feat/codespaces` | `src/services/platforms/`, `Dockerfile`, `test/` | |
| 4 | Workspace tools | Agent tools, timeout, error codes | git-server-agents | `feat/workspace-tools` | `src/services/agent/`, `src/services/agentErrors.js`, `test/` | |
| 5 | Chat | SSE rooms, stored messages, chat agent | git-server-agents | `feat/chat` | `src/services/chat/`, `src/routes/chat.js`, `prisma/`, `test/` | |
| 6 | Streaming | Token streaming, progress events | git-server-agents | `feat/agent-streaming` | `src/services/ai/`, `src/services/agent/`, `src/worker.js`, `test/` | |
| 7 | Release | 1.18.0 changelog and version | git-server-agents | `release/1.18.0` | `package.json`, `wiki/logs/` | |

The dashboard side (workspace keys UI, 3-pane chat page) ships as client 1.14.0 and merges after this chain.

### Task 1 — plan/codespaces-and-chat

This record was written before the work. Nothing else changed.

### Task 2 — feat/workspace-keys

- `WorkspaceKey` in both schemas (relations cascade like `AccountKey`; needs `npm run db:push`).
- `services/workspaceKeyService.js`: `getWorkspaceKeys(provider, account, installation, repository)` returns key handles repo → org → user, each by priority; `reveal()` re-reads the row and decrypts at the moment of use, and refuses a key switched off since. No key → `NoWorkspaceKeyError` (401, code `NO_WORKSPACE_KEY`). `findWorkspaceKeys` returns `[]` instead.
- `services/workspaceKeyStore.js` + `controllers/workspaceKeyController.js`: `/api/user/workspace-keys`, `/orgs/:id/workspace-keys` (owner), `/repos/:id/workspace-keys` (admin). GitHub owners only. `keyStore` now exports `ownerView`.
- Tests: `test/workspaceKeys.test.js`.
