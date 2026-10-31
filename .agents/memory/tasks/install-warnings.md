---
name: install-warnings
description: Task record for clearing the npm install warnings in git-server-agents (1.1.2).
status: done
---

# Install warnings

## Goal / Objective / Detail

- **Goal:** `npm i` runs clean, as the owner asked on 2026-10-31.
- **Objective:** no deprecation warning, 0 vulnerabilities, and no unapproved install scripts on
  npm 11 and npm 12; 51 tests still pass on SQLite and PostgreSQL.
- **Detail:**
  - `prebuild-install` comes from `better-sqlite3` 12, which is required by
    `@prisma/adapter-better-sqlite3`. It is replaced by `@prisma/adapter-libsql`, which ships
    prebuilt binaries.
  - The `minimatch` advisory comes from `nodemon`, which is replaced by `node --watch`.
  - npm 12 blocks dependency install scripts unless `package.json` `allowScripts` approves them.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/install-warnings` | `.agents/` | #17 |
| 2 | Fix | libsql adapter, `node --watch`, `allowScripts`, Node engines | git-server-agents | `fix/install-warnings` | `package*.json`, `src/db.js`, `.nvmrc`, README | #18 |
| 3 | Release | 1.1.2 changelog and version | git-server-agents | `release/1.1.2` | `wiki/logs/`, `package.json` | #19 |
