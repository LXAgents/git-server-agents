# 1.17.0 — 2026-11-01

## Added

- **The agent knows its own PR's branches.** On a pull request or merge request, the prompt names the head and base branches and the head commit, so "which branch is this?" needs no tool. They come from the webhook payload, or from the PR the agent already fetches for its head commit.
- **`read_pull_request` on this PR.** It is offered on every PR or MR thread, and reads this one without a mention or a number, for its current state, labels and latest comments.

- **`!12` is an issue on GitHub.** "What !1 about?" now reads issue 1; before, it wasn't a mention and the agent answered about the thread it was on. `#12` is a pull request, or an issue when no PR has that number. GitLab keeps `#12` for issues and `!12` for merge requests. The agent is told to answer about the mentioned issue or PR, or say it can't read it.

## Unchanged

- Issues get nothing new. No schema, API, env or dashboard change, and no new permissions.
