# 1.16.0 — 2026-11-01

## Added

- **Reading mentioned issues and pull requests.** When the comment mentions `#12`, `GH-12`, `!12` (GitLab merge request) or a link in the same repository, the agent can call `read_issue` (title, state, labels, description, last 10 comments) and `read_pull_request` (the same, plus branches and diff). An issue can read a PR and a PR can read an issue.
- **Commits.** `list_commits` lists this PR's or MR's commits, or a mentioned one's. `read_commit` returns one commit's message and diff.
- Anything the comment doesn't mention is refused in code, so files and earlier comments can't point the agent at other threads. Other repositories are never read. Diffs from these tools are cut at 40,000 characters and descriptions at 20,000.

## Unchanged

- No schema, API, env or dashboard change. The GitHub App and GitLab bot permissions from 1.15.0 already cover these reads.
