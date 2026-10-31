---
name: latest-dependencies
description: Task record for moving git-server-agents to the latest dependencies (1.1.1).
status: in-progress
---

# Latest dependencies

## Goal / Objective / Detail

- **Goal:** run only on the latest dependencies, as the owner asked on 2026-10-31.
- **Objective:** Prisma 7.10.1 (CLI and client), Node 26 LTS in CI, `actions/checkout` and
  `actions/setup-node` v7, PostgreSQL 18 in CI, refreshed lockfile; all tests pass on SQLite
  and PostgreSQL.
- **Detail:** the `prisma` CLI's `latest` tag is `8.0.0-rc.29`, a release candidate, while
  `@prisma/client`'s `latest` is 7.10.1; both must match, so both go to 7.10.1. Prisma 7
  moves the connection URL out of the schema into `prisma.config.js` and needs a driver
  adapter (`@prisma/adapter-better-sqlite3` or `@prisma/adapter-pg`).

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/latest-dependencies` | `.agents/` | |
| 2 | Upgrade | Prisma 7, adapters, CI versions, lockfile | git-server-agents | `build/latest-deps` | `package*.json`, `prisma/`, `src/db.js`, CI | |
| 3 | Release | 1.1.1 changelog and version | git-server-agents | `release/1.1.1` | `wiki/logs/`, `package.json` | |
