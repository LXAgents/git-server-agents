---
name: agent-actions
description: Task record for the comment-set tool loop limit and the issue and pull request / merge request tools (server 1.15.0).
status: done
---

# Loop limits and issue / PR tools for the agent

## Goal / Objective / Detail

- **Goal:** the agent can act on the thread, not only answer. owen asked for this on 2026-11-01. The plan is `/mnt/project-files/plans/agent-actions.md`.
- **Objective:** a comment such as "run this 5 times" sets the tool rounds (default 3, capped by `MAX_TOOL_ROUNDS`, default 20). The model can call `create_issue`, `close_issue`, `reopen_issue`, `create_pull_request`, `close_pull_request` and `reopen_pull_request` on GitHub and GitLab (merge requests there). Failures come back to the model as `Error: …` text.
- **Detail:** the six manage tools are offered only to commenters with write access to the repository (GitHub write, maintain or admin; GitLab Developer or above), checked fail closed, because the agent answers anyone in an imported org. The system prompt tells the model to act only when the commenter's own message asks for it. No schema or API change.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/agent-actions` | `.agents/` | #73 |
| 2 | Loop limit | Rounds read from the comment, tool guide in the prompt | git-server-agents | `feat/agent-loop-limit` | `src/services/agent/`, `src/config.js`, `test/`, `wiki/` | #74 |
| 3 | Issue tools | Create, close, reopen issues; write-access check | git-server-agents | `feat/issue-tools` | `src/services/agent/`, `src/services/platforms/`, `test/`, `wiki/` | #75 |
| 4 | Pull request tools | Create, close, reopen PRs and MRs | git-server-agents | `feat/pull-request-tools` | `src/services/agent/`, `src/services/platforms/`, `test/`, `wiki/` | #76 |
| 5 | Release | 1.15.0 changelog and version | git-server-agents | `release/1.15.0` | `package.json`, `wiki/logs/` | #77 |

### Task 1 — plan/agent-actions

This record was written before the work. Nothing else changed.

### Task 2 — feat/agent-loop-limit

- `agent/loopLimit.js` reads the rounds from the comment ("run this 5 times", "loop ten times", "up to 4 rounds", "twice"); a count only counts in a sentence with a run/loop/repeat-style verb. Default 3, capped by `MAX_TOOL_ROUNDS` (default 20).
- `conversation.js` takes `maxRounds` and the tools from the repository tools object; `ANSWER_NOW` is exported for tests.
- `prompt.js`: `buildSystemPrompt(comment, diff)` no longer describes tools. `buildToolGuide({ rounds })` does, and only the tool path adds it, so the no-tools fallback stops claiming tools.
- owen asked (2026-11-01) for a `Loop:` footer line: it shows the rounds the answer was allowed, between Cost and User, and `stripReply` drops it from history.
- Docs: the asking-the-agent guide, configuration, code layout, webhooks, README, `.env.example`. Tests: 168 pass on SQLite.

### Task 3 — feat/issue-tools

- `githubService`: `getCollaboratorPermission`, `createIssue`, `setIssueState` (refuses a number that is a PR, since GitHub's issues endpoint would close it). `gitlabService`: `getMemberAccessLevel` (now behind `isProjectMember`), `createIssue`, `setIssueState` (`state_event`, "opened" reported as "open").
- `agent/threadActions.js` (new) validates arguments and defaults `number` to this thread. `repoTools.js` holds the `create_issue`, `close_issue`, `reopen_issue` schemas and turns failures into `Error: …` text with the platform's status and message.
- `membership.canManage` (fail closed): GitHub write/maintain/admin, GitLab Developer (30) or above. Only then are the tools offered and described in the tool guide, with the rule to act only on the commenter's own request.
- Tests: `platformActions.test.js` (routes and bodies against a fake API), `agentTools.test.js`, `agentTask.test.js`. 180 pass on SQLite.
- Task 4 builds on `threadActions.js`, `MANAGE_TOOLS` and the adapter methods.

### Task 4 — feat/pull-request-tools

- `githubService`: `createPullRequest`, `setPullRequestState` (`/pulls`). `gitlabService`: `createMergeRequest` (`Draft:` prefix for drafts), `setMergeRequestState` (`state_event`). The adapter maps both to `createPullRequest` / `setPullRequestState` and names them "pull request #" or "merge request !".
- `create_pull_request` (`title`, `head` required; `base` defaults to the default branch; `body`, `draft`), `close_pull_request`, `reopen_pull_request`. Branch names are checked before any call; it never creates branches or commits.
- A create that already succeeded in this answer is not repeated (a key fallback reruns the tool loop, and models repeat themselves); the second call returns the first result.
- Docs: the asking-the-agent table and examples; the GitLab bot needs Developer for merge requests. Tests: 187 pass on SQLite.

### Task 5 — release/1.15.0

Version 1.15.0, the changelog at `wiki/logs/1/15/0/CHANGELOG.md` and its index row. The PR column is filled in. No dashboard change.
