---
name: agent-pr-branch
description: Task record for telling the agent its own pull request's branches and letting it read its own PR (server 1.17.0).
status: in-progress
---

# The agent knows its own PR's branches

## Goal / Objective / Detail

- **Goal:** asked "What branch name in this pr?" on a PR, the agent answers. owen asked on 2026-11-01 after the agent on PR #3 could not. The plan is `/mnt/project-files/plans/agent-pr-branch.md`.
- **Objective:** on a PR or MR, the system prompt names the head and base branches and the head commit, and `read_pull_request` works on this PR without a mention.
- **Detail:** branch names come from the webhook payload when it has them, otherwise from the PR the agent already fetches for its head commit, so there is no extra API call. Issues are unchanged.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/agent-pr-branch` | `.agents/` | |
| 2 | PR branches | Payload refs, prompt line, own-PR read tool, tests, docs | git-server-agents | `feat/pr-branch` | `src/services/agent/`, `src/services/eventService.js`, `test/`, `wiki/` | |
| 3 | Release | 1.17.0 changelog and version | git-server-agents | `release/1.17.0` | `package.json`, `wiki/logs/` | |

### Task 1 — plan/agent-pr-branch

This record was written before the work. Nothing else changed.
