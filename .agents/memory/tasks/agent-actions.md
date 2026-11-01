---
name: agent-actions
description: Task record for the comment-set tool loop limit and the issue and pull request / merge request tools (server 1.15.0).
status: in progress
---

# Loop limits and issue / PR tools for the agent

## Goal / Objective / Detail

- **Goal:** the agent can act on the thread, not only answer. owen asked for this on 2026-11-01. The plan is `/mnt/project-files/plans/agent-actions.md`.
- **Objective:** a comment such as "run this 5 times" sets the tool rounds (default 3, capped by `MAX_TOOL_ROUNDS`, default 20). The model can call `create_issue`, `close_issue`, `reopen_issue`, `create_pull_request`, `close_pull_request` and `reopen_pull_request` on GitHub and GitLab (merge requests there). Failures come back to the model as `Error: …` text.
- **Detail:** the six manage tools are offered only to commenters with write access to the repository (GitHub write, maintain or admin; GitLab Developer or above), checked fail closed, because the agent answers anyone in an imported org. The system prompt tells the model to act only when the commenter's own message asks for it. No schema or API change.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/agent-actions` | `.agents/` | |
| 2 | Loop limit | Rounds read from the comment, tool guide in the prompt | git-server-agents | `feat/agent-loop-limit` | `src/services/agent/`, `src/config.js`, `test/`, `wiki/` | |
| 3 | Issue tools | Create, close, reopen issues; write-access check | git-server-agents | `feat/issue-tools` | `src/services/agent/`, `src/services/platforms/`, `test/`, `wiki/` | |
| 4 | Pull request tools | Create, close, reopen PRs and MRs | git-server-agents | `feat/pull-request-tools` | `src/services/agent/`, `src/services/platforms/`, `test/`, `wiki/` | |
| 5 | Release | 1.15.0 changelog and version | git-server-agents | `release/1.15.0` | `package.json`, `wiki/logs/` | |

### Task 1 — plan/agent-actions

This record was written before the work. Nothing else changed.

### Task 2 — feat/agent-loop-limit

- `agent/loopLimit.js` reads the rounds from the comment ("run this 5 times", "loop ten times", "up to 4 rounds", "twice"); a count only counts in a sentence with a run/loop/repeat-style verb. Default 3, capped by `MAX_TOOL_ROUNDS` (default 20).
- `conversation.js` takes `maxRounds` and the tools from the repository tools object; `ANSWER_NOW` is exported for tests.
- `prompt.js`: `buildSystemPrompt(comment, diff)` no longer describes tools. `buildToolGuide({ rounds })` does, and only the tool path adds it, so the no-tools fallback stops claiming tools.
- owen asked (2026-11-01) for a `Loop:` footer line: it shows the rounds the answer was allowed, between Cost and User, and `stripReply` drops it from history.
- Docs: the asking-the-agent guide, configuration, code layout, webhooks, README, `.env.example`. Tests: 168 pass on SQLite.
