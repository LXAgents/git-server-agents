---
name: profiles-roles-platform
description: Task record for platform profiles, the owner role and one platform per session (1.7.0).
status: in-progress
---

# Profiles from the platform, the owner role, one platform per session

## Goal / Objective / Detail

- **Goal:** the owner asked on 2026-10-31 to stop storing usernames, to rename Admin to Owner
  as a role in the database, and to keep each session on one platform.
- **Objective:**
  - Read the login, name and avatar from GitHub/GitLab instead of storing them.
  - Add a lower-case `role` (`owner`, `member`) on accounts.
  - Show the owner and operator views for the session's platform only, and drop the Platform
    column.
- **Detail:** profiles are cached in memory for 10 minutes and never written to the database.
  The operator token sign-in now picks a platform too.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/profiles-roles-platform` | `.agents/` | |
| 2 | Profiles, role, platform scope | Profile lookup, role column, scoped owner views, tests, docs | git-server-agents | `feat/profiles-roles-platform` | `src/`, `prisma/`, `scripts/`, `test/`, `README.md` | |
| 3 | Release | 1.7.0 changelog and version | git-server-agents | `release/1.7.0` | `wiki/logs/`, `package.json` | |
