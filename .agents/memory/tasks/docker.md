---
name: docker
description: Task record for the git-server-agents Docker image (1.2.0).
status: in-progress
---

# Docker image

## Goal / Objective / Detail

- **Goal:** run the server on any online platform that runs Docker, as the owner asked on
  2026-10-31.
- **Objective:** a root `Dockerfile` that builds with no build args, listens on `$PORT`, and
  prepares its own database on start (schema chosen by `PROD`, client generated, `db push`, seed),
  so a platform needs no shell; `/health` drives the container health check.
- **Detail:** platform disks are usually wiped on redeploy, so the README recommends `PROD=prod`
  with a managed PostgreSQL, or a volume at `/app/prisma` for SQLite. `prisma` moves to
  `dependencies` because the container runs the CLI at start.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/docker` | `.agents/` | #20 |
| 2 | Docker image | Dockerfile, entrypoint, .dockerignore, README | git-server-agents | `feat/docker` | root, `package.json`, README | #21 |
| 3 | Release | 1.2.0 changelog and version | git-server-agents | `release/1.2.0` | `wiki/logs/`, `package.json` | #22 |
