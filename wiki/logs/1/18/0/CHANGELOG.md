# 1.18.0 — 2026-11-01

## Added

- **Workspace keys.** GitHub personal access tokens with the `codespace` scope, for yourself, an org or a repository (`/api/user/workspace-keys`, `/orgs/:id/workspace-keys`, `/repos/:id/workspace-keys`). Stored encrypted like AI keys and decrypted at each Codespaces call. The agent tries the repository's, then the org's, then the commenter's own, each by priority; repository keys only for its collaborators, org keys only for org members.
- **The agent works in a GitHub Codespace.** `create_workspace`, `exec_command`, `commit_workspace` and `delete_workspace`, for commenters with write access on GitHub who have a workspace key they may use. Only codespaces the answer created can be reached (at most two), output is cut to 10,000 characters, pushes to the default branch are refused, and every codespace still open is deleted when the answer ends. Such answers may take `WORKSPACE_TASK_TIMEOUT_MS` (15 minutes). New error codes `NO_WORKSPACE_KEY`, `WORKSPACE_ERROR`, `WORKSPACE_UNAVAILABLE`.
- **Chat rooms.** `/api/chat` with `user:{accountId}`, `repo:{repoId}` and `org:{orgId}` rooms, chat sessions (`ChatSession`, `ChatMessage`, after owen's `chat_sessions` / `chat_messages`), and a Server-Sent Events stream. Access is checked on the platform with the caller's own token on every request, and every five minutes on an open stream. The agent answers every message in your user room and `@lxagents` messages in repo and org rooms, with the room's model and keys.
- **Live progress and streamed answers.** Answers to comments show progress, tool calls, the text as it is written, and a final report in the commenter's user room and the repository's room. Replies are streamed from the provider only while someone watches.

## Changed

- The Docker image installs the `gh` CLI and an SSH client (for `gh codespace ssh`).
- CORS allows `PATCH` (renaming a chat session).

## Upgrade

- Run `npm run db:push` (new tables `WorkspaceKey`, `ChatSession`, `ChatMessage`; the Docker entrypoint does it on start).
- New optional settings: `WORKSPACE_TASK_TIMEOUT_MS`, `WORKSPACE_BOOT_TIMEOUT_MS`, `WORKSPACE_EXEC_TIMEOUT_MS`, `WORKSPACE_IDLE_TIMEOUT_MINUTES`, `GH_PATH`.
- Live chat events reach streams in the same process; with `WORKER_INLINE=false` stored messages still show but live progress from comment answers does not.
- Dashboard 1.14.0 adds the workspace keys and Chat pages.
