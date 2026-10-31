# 1.9.0 — 2026-10-31

## Removed

- **The operator sign-in.** `ADMIN_TOKEN` is gone. `/api/admin` opens only for the platform
  owner (the user in `GITHUB_ADMIN_ID` or `GITLAB_ADMIN_ID`), signed in with their own GitHub
  or GitLab token.
  - The owner already had every operator function, so nothing moved.
  - A leftover `ADMIN_TOKEN` in the environment is ignored.
  - Deploy with git-client-agents 1.8.0.
