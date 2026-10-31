---
name: agent-context
description: Task record for agent chat history, repository file reading and stricter trigger and key rules (1.4.0).
status: done
---

# Agent context and stricter rules

## Goal / Objective / Detail

- **Goal:** the agent remembers the conversation on an issue or PR/MR, can read the
  repository's files, and answers only when asked properly, as the owner asked on 2026-10-31.
- **Objective:**
  - The last 30 comments become chat history: replies with the marker are `assistant`, and the
    rest are `user`.
  - The model gets `list_files` and `read_file` tools that read the PR/MR head or the default
    branch through the REST APIs.
  - Comments without `@vendor/model` on line 1 are skipped.
  - Org keys are used only when the triggering user is a member of the org.
- **Detail:**
  - Models that don't support tools get one retry without tools. That retry includes the file
    tree and any files named in the question.
  - Membership checks fail closed.
  - `DEFAULT_MODEL` becomes `openrouter/free` and is only a suggestion now.
  - No clone and no shell. GitHub uses the installation token, and GitLab uses the bot token.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/agent-context` | `.agents/` | #26 |
| 2 | Agent context | History, files, tools, strict rules, tests, docs | git-server-agents | `feat/agent-context` | `src/services/`, `test/`, README, `.env.example` | #27 |
| 3 | Release | 1.4.0 changelog and version | git-server-agents | `release/1.4.0` | `wiki/logs/`, `package.json` | #28 |
