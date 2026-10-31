# 1.8.0 — 2026-10-31

## Changed

- **One owner per platform.** The owner is the single user ID in `GITHUB_ADMIN_ID` (GitHub) or
  `GITLAB_ADMIN_ID` (GitLab).
  - A comma list now stops the server at start. Cut it to one ID before upgrading.
  - When the configured owner signs in, every other account of that platform still marked
    `owner` goes back to `member`. Until then, those accounts already count as members.
  - `POST /api/admin/accounts` only adds members. `role: "owner"` answers 400.
  - To hand over ownership, change the variable and restart.
