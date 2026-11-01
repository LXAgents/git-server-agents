# 1.15.0 — 2026-11-01

## Added

- **Tool rounds from the comment.** "Run this 5 times", "loop ten times" or "up to 4 rounds" sets how many tool rounds the answer gets. A comment that names no number gets 3. `MAX_TOOL_ROUNDS` (default 20) caps it, and `TASK_TIMEOUT_MS` still limits the whole answer. The model is told how many rounds it has.
- **Issue tools:** `create_issue`, `close_issue` and `reopen_issue`.
- **Pull request tools:** `create_pull_request`, `close_pull_request` and `reopen_pull_request`. On GitLab they work on merge requests. `create_pull_request` opens one from an existing branch, into the default branch unless `base` is given.
- The six manage tools are offered only to commenters with write access to the repository (GitHub write, maintain or admin; GitLab Developer or above). If that check fails, they aren't offered. Failures go back to the model with the platform's status and message, so it can retry or explain. Everything the agent opens ends with `Opened by LXAgents for @login`.

## Changed

- A model asked without tools is no longer told it has tools.

## Deploy

- The GitHub App already needs Issues and Pull requests read and write. The GitLab bot needs the `api` scope and the Developer role to manage merge requests.
- No schema or API change. The dashboard is unchanged.
