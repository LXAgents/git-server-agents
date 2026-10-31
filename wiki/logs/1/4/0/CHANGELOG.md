# 1.4.0 — 2026-10-31

The agent remembers the conversation, can read the repository's files, and answers only when
asked with a model.

## Added

- **Chat history:** the last 30 comments on the issue, PR or MR are sent as chat history. The
  agent's replies count as `assistant` and everyone else as `user`, with their `@login`.
  - GitHub: `listIssueComments` (paginated).
  - GitLab: `listNotes`, which drops system notes.
- **Repository files:** the model gets two tools, `list_files` and `read_file`, for up to 5
  rounds.
  - They read the PR or MR head commit, or the default branch for an issue.
  - GitHub uses the Git trees and contents APIs with the installation token, and GitLab uses
    the repository tree and raw file APIs with the bot token.
  - Files are cut at 40,000 characters, the list at 2,000 paths, and binary files are refused.
- **Models without tool support** get one retry without tools. That retry includes the file
  list and any files the question names.
- **Org membership check:**
  - GitHub organizations: `GET /orgs/{org}/members/{login}`.
  - GitLab groups: `GET /groups/{group}/members/all/{id}`.
  - Personal accounts: owner only.

## Changed

- **A model is required.** A comment is answered only when line 1 is `@vendor/model`. Others
  are skipped, including a first line that mentions a user.
- **Org keys need membership.** The triggering user's own keys are always tried first. The org's
  keys are added only for confirmed org members. Errors count as "not a member".
- **`DEFAULT_MODEL`** is now `openrouter/free`, and is only the suggestion shown in the log for
  skipped comments.

## Notes

- The GitHub App needs **Contents: read** for files, as well as Members: read.
- Nothing is cloned. Every read goes through the REST APIs.
