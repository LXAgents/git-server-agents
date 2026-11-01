---
name: codespaces-and-chat
description: Task record for GitHub Codespaces workspace keys and agent tools, and the 3-room real-time chat with progress and token streaming (server 1.18.0).
status: done
---

# Codespaces workspaces and real-time chat

## Goal / Objective / Detail

- **Goal:** the agent can work in a real development environment: start a GitHub Codespace, run commands, commit and push, and show its progress live in a chat with User, Repository and Org rooms. owen asked on 2026-11-01; the plan is `/mnt/project-files/plans/codespaces-and-chat.md`.
- **Objective:** workspace keys (GitHub PATs with the `codespace` scope) per user, org and repo with repo → org → user fallback; `create_workspace`, `exec_command`, `commit_workspace`, `delete_workspace` tools for commenters with write access; `/api/chat` with SSE rooms, stored messages, progress and streamed tokens; the agent answers `@lxagents` in the chat.
- **Detail:** zero trust stays: keys are decrypted at each use and never cached, room access is checked on every request, the tools only touch codespaces created in the same answer and delete them at the end. GitHub only (GitLab has no Codespaces). Nothing existing is removed.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/codespaces-and-chat` | `.agents/` || #84 |
| 2 | Workspace keys | Schema, fallback service, key API | git-server-agents | `feat/workspace-keys` | `prisma/`, `src/services/`, `src/controllers/`, `src/routes/`, `test/` || #85 |
| 3 | Codespaces service | REST calls, `gh codespace ssh`, Dockerfile | git-server-agents | `feat/codespaces` | `src/services/platforms/`, `Dockerfile`, `test/` || #86 |
| 4 | Workspace tools | Agent tools, timeout, error codes | git-server-agents | `feat/workspace-tools` | `src/services/agent/`, `src/services/agentErrors.js`, `test/` || #87 |
| 5 | Chat | SSE rooms, stored messages, chat agent | git-server-agents | `feat/chat` | `src/services/chat/`, `src/routes/chat.js`, `prisma/`, `test/` || #88 |
| 6 | Streaming | Token streaming, progress events | git-server-agents | `feat/agent-streaming` | `src/services/ai/`, `src/services/agent/`, `src/worker.js`, `test/` || #89 |
| 7 | Release | 1.18.0 changelog and version | git-server-agents | `release/1.18.0` | `package.json`, `wiki/logs/` || #90 |

The dashboard side (workspace keys UI, 3-pane chat page) ships as client 1.14.0 and merges after this chain.

### Task 1 — plan/codespaces-and-chat

This record was written before the work. Nothing else changed.

### Task 2 — feat/workspace-keys

- `WorkspaceKey` in both schemas (relations cascade like `AccountKey`; needs `npm run db:push`).
- `services/workspaceKeyService.js`: `getWorkspaceKeys(provider, account, installation, repository)` returns key handles repo → org → user, each by priority; `reveal()` re-reads the row and decrypts at the moment of use, and refuses a key switched off since. No key → `NoWorkspaceKeyError` (401, code `NO_WORKSPACE_KEY`). `findWorkspaceKeys` returns `[]` instead.
- `services/workspaceKeyStore.js` + `controllers/workspaceKeyController.js`: `/api/user/workspace-keys`, `/orgs/:id/workspace-keys` (owner), `/repos/:id/workspace-keys` (admin). GitHub owners only. `keyStore` now exports `ownerView`.
- Tests: `test/workspaceKeys.test.js`.

### Task 3 — feat/codespaces

- `services/platforms/githubCodespacesService.js`: `createCodespace(repoFullName, branch, token)` (POST `/repos/{owner}/{repo}/codespaces` with `ref` and `idle_timeout_minutes`), `getCodespaceStatus`, `waitUntilAvailable` (decrypts again for every poll through a `getToken` callback), `deleteCodespace` (404 counts as deleted), `executeCommand` (`gh codespace ssh -c <name> -- bash -lc <command>` through `execFile`, no host shell, child env = `GH_TOKEN` + PATH/HOME/LANG only, never the server's secrets). Failures are `CodespacesError` with `source: 'codespaces'` and code `WORKSPACE_ERROR`, `WORKSPACE_UNAVAILABLE` or `BAD_INPUT`.
- `config.workspace` (`WORKSPACE_*_MS`, `WORKSPACE_IDLE_TIMEOUT_MINUTES`, `GH_PATH`), `.env.example`, configuration page.
- Dockerfile installs `gh` from GitHub's apt repository and `openssh-client`. Not built in the sandbox.
- Tests: `test/codespaces.test.js` (mock REST API, mocked `execFile`).

### Task 4 — feat/workspace-tools

- `agent/workspaceTools.js`: `create_workspace`, `exec_command`, `commit_workspace`, `delete_workspace`. Keys are tried in fallback order on create (401/403/404/422 → next key); each workspace remembers its key handle and every call reveals the token again. Only codespaces created in this answer are reachable, at most two, and `cleanup()` deletes what is left (called in a `finally` in `agent/index.js`). Output capped at 10,000 characters (end kept). `commit_workspace` quotes its arguments for the remote shell and refuses the default branch. Returns `{ handlers, cleanup, openWorkspaces }` so `cleanup` is never a tool.
- Offered when the platform adapter has `workspaces: true` (GitHub), the commenter passes `canManage`, and `findWorkspaceKeys` finds a key with the same membership rules as AI keys. Such answers use `WORKSPACE_TASK_TIMEOUT_MS`.
- `agentErrors.js`: `NO_WORKSPACE_KEY`, `WORKSPACE_ERROR`, `WORKSPACE_UNAVAILABLE`. Tool guide explains the tools.
- Tests: `test/workspaceTools.test.js`. Docs: asking-the-agent, code layout.

### Task 5 — feat/chat

- owen added his `chat_sessions` / `chat_messages` tables on 2026-11-01 ("make it fit to our project"): `ChatSession` (cuid, `room`, `title` default "New Chat", `createdBy`, timestamps; index `[room, updatedAt]`) and `ChatMessage` (cuid, `sessionId` with cascade, `role` user/assistant, `type` message/report, sender id/login, `content`; index `[sessionId, createdAt]`). cuid ids instead of VARCHAR(36)/INTEGER to match every other table.
- `services/chat/`: `rooms.js` (parse and authorize `user:`/`repo:`/`org:`; user room keys carry the platform), `chatStore.js` (sessions, messages, "Agent activity" session), `bus.js` (in-process pub/sub), `events.js` (the event shape), `index.js` (`emit`, `broadcaster`), `chatAgent.js` (answers in the room with the room's model and keys; repo rooms get read tools at the default branch and, for writers on GitHub with a key, the workspace tools; one answer per session at a time).
- `platformService.repoAccess` (admin/write/read/none + default branch, from the user's token) and `platformService.isOrgMember`.
- `/api/chat` routes (rooms, sessions, messages, stream); PATCH added to CORS methods. The stream re-checks access every 5 minutes.
- Mock platform repos now carry `pull`/`push` and `default_branch`.
- Tests: `test/chat.test.js`. Docs: `wiki/guides/chat.md` (indexed), API reference, code layout.

### Task 6 — feat/agent-streaming

- `ai/chatStream.js`: streamed Chat Completions (SSE) for OpenRouter and the OpenAI-compatible clients; text goes to `onToken`, tool-call pieces are joined by index, OpenRouter's cost comes from the last chunk's usage, errors inside the stream and streamed error bodies keep their status and message, and the whole stream is bound by the call's timeout. Anthropic uses the SDK's `messages.stream`. Without `onToken` nothing changes.
- `agent/conversation.js`: `request.onToken`, `request.onRound` (each model call; the chat clears streamed text) and `request.onTool({ tool, status })` before each tool runs, all wrapped so a listener can't break an answer.
- `agent/chatProgress.js` + `agent/index.js`: comment answers go to the commenter's user room and the repository room: progress, tokens (only while someone watches one of the rooms), and a stored `report` (answer or error reply) in the "Agent activity" session. Workspace progress goes there too. The chat agent uses the same hooks.
- `worker.js` is unchanged: every event comes from where the work happens (the agent flow), and the worker only claims tasks.
- Tests: `test/streaming.test.js`, chat and tool-loop hook tests.

### Task 7 — release/1.18.0

Version 1.18.0, the changelog at `wiki/logs/1/18/0/CHANGELOG.md` and its index row, and the PR column above. Tests: 236 pass on SQLite. Not verified from the sandbox: real Codespaces calls and `gh codespace ssh` (needs a PAT with the codespace scope), and the Docker build.
