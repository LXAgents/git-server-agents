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
| 1 | Plan | This record | git-server-agents | `plan/agent-pr-branch` | `.agents/` | #81 |
| 2 | PR branches | Payload refs, prompt line, own-PR read tool, tests, docs | git-server-agents | `feat/pr-branch` | `src/services/agent/`, `src/services/eventService.js`, `test/`, `wiki/` | |
| 3 | Release | 1.17.0 changelog and version | git-server-agents | `release/1.17.0` | `package.json`, `wiki/logs/` | |

### Task 1 — plan/agent-pr-branch

This record was written before the work. Nothing else changed.

### Task 2 — feat/pr-branch

- `toComment` carries `headRef` / `baseRef` from GitHub review-comment and GitLab MR-note payloads.
- `platform.resolveSource` (was `resolveRef`) returns `{ ref, head, base }`. On a GitHub PR-conversation comment it reads them from the PR it already fetches.
- `buildSystemPrompt(comment, diff, { head, base, sha })` adds `Branches: \`head\` into \`base\`` and `Head commit:` on a PR or MR.
- `read_pull_request` is offered on a PR thread without a mention, and its `number` may be left out for this PR.
- owen's follow-up (2026-11-01, "What !1 about?" was answered about issue #2): on GitHub `!N` now names an issue, and the tool guide says `!12` is an issue and `#12` a PR (or an issue). GitLab keeps its own `#` issue / `!` MR. The guide also tells the model to answer about the mentioned thread, or say it can't be read, instead of falling back to this one.
- Tests: 201 pass on SQLite.
