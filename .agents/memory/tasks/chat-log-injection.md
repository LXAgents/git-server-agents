---
name: chat-log-injection
description: Task record for the SonarCloud log-injection finding in the chat stream (1.18.1).
status: in progress
---

# Chat log injection fix

## Goal / Objective / Detail

- **Goal:** clear the SonarCloud "Log Injection" finding (jssecurity:S5145) the owner reported on
  2026-11-02. The `?room=` query of `/api/chat/stream` reaches `logService.write` through the
  "stream opened on a … room" line in `chatController.js`.
- **Objective:** values from requests or from other services go through `logSafe()` before they
  are logged, as since 1.4.2.
- **Detail:**
  - The room kind is already limited to `user`, `repo` or `org` by the `ROOM` regex, so no
    forged line was possible, but the analysis can't see that. `logSafe()` makes it explicit.
  - The two other 1.18.0 log lines with outside values get the same treatment: the workspace
    key refusal (`err.code` from the Codespaces call) and the chat send failure (`err.message`).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/chat-log-injection` | `.agents/` | |
| 2 | Log injection | `logSafe()` on the chat and workspace log lines | git-server-agents | `fix/chat-log-injection` | `src/` | |
| 3 | Release | 1.18.1 changelog and version | git-server-agents | `release/1.18.1` | `wiki/logs/`, `package.json` | |
