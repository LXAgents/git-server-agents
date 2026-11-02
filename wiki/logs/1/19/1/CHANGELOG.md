# 1.19.1 — 2026-11-02

The chat agent can now create, close and reopen issues and pull requests in repository rooms.
Before, those tools were only given to answers to comments, so in chat the agent said it could
only list and read files.

## Fixed

- Repository rooms give the agent `create_issue`, `close_issue`, `reopen_issue`,
  `create_pull_request`, `close_pull_request` and `reopen_pull_request` for members with write
  access (GitHub write, maintain or admin; GitLab Developer or higher), checked for every message.
- `read_issue`, `read_pull_request`, `list_commits` and `read_commit` work in chat for the issues,
  pull requests and commits the message mentions.
- The agent is told when the asker can only read the repository, and in organization and
  personal rooms that there is no repository to change.

No schema, API or setting change.
