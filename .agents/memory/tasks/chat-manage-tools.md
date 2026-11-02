---
name: chat-manage-tools
description: Task record for giving the chat agent the issue and pull request tools in repository rooms (1.19.1).
status: in progress
---

# Manage tools in chat rooms

## Goal / Objective / Detail

- **Goal:** owen asked on 2026-11-02 why the chat agent refused to create an issue, and to fix it. Plan: `/mnt/project-files/plans/chat-manage-tools.md`.
- **Objective:**
  - Repository rooms offer `create_issue`, `close_issue`, `reopen_issue`, `create_pull_request`, `close_pull_request` and `reopen_pull_request` to members with write access, like comment answers.
  - `read_issue`, `read_pull_request`, `list_commits` and `read_commit` work for numbers and shas the chat message mentions.
- **Detail:**
  - Write access comes from the room check (`repoAccess` level `write` or `admin`), done again on every message.
  - Readers get a prompt line saying they cannot change issues or pull requests, so the model explains instead of guessing.
  - Organization and personal rooms have no repository and stay without tools.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/chat-manage-tools` | `.agents/` | |
| 2 | Chat manage tools | Tools, prompt, tests, docs | git-server-agents | `fix/chat-manage-tools` | `src/services/chat/`, `test/`, `wiki/` | |
| 3 | Release | 1.19.1 changelog and version | git-server-agents | `release/1.19.1` | `wiki/logs/`, `package.json` | |
