---
name: agent-read-references
description: Task record for letting the agent read the issues, pull requests, PR diffs and commits a comment mentions (server 1.16.0).
status: in progress
---

# The agent reads mentioned issues, pull requests, diffs and commits

## Goal / Objective / Detail

- **Goal:** the agent can use other threads in the same repository when the commenter points at them. owen asked for this on 2026-11-01, plus PR diffs and per-commit diffs ("so agents will have all tools it need"). The plan is `/mnt/project-files/plans/agent-read-references.md`.
- **Objective:** `read_issue`, `read_pull_request` (with its diff), `list_commits` and `read_commit` work on GitHub and GitLab. An issue can read a PR and a PR can read an issue.
- **Detail:** another issue or PR is read only when the commenter's own message mentions it: `#12`, `!12`, `GH-12`, or a link into this repository. This is enforced in code (the tools refuse other numbers), not only in the prompt. This thread's own PR or MR needs no mention for its commits. Other repositories are never read. Read-only, so every commenter gets these tools.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Plan | This record | git-server-agents | `plan/agent-read-references` | `.agents/` | |
| 2 | Read tools | Mention parsing, read tools, platform calls, tests, docs | git-server-agents | `feat/read-references` | `src/services/agent/`, `src/services/platforms/`, `src/services/eventService.js`, `test/`, `wiki/` | |
| 3 | Release | 1.16.0 changelog and version | git-server-agents | `release/1.16.0` | `package.json`, `wiki/logs/` | |

### Task 1 — plan/agent-read-references

This record was written before the work. Nothing else changed.
