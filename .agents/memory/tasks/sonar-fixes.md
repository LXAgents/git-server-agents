---
name: sonar-fixes
description: Task record for the SonarCloud findings on the server (1.4.1).
status: done
---

# SonarCloud fixes

## Goal / Objective / Detail

- **Goal:** clear the 14 SonarCloud findings the owner reported on 2026-10-31. Fix the real ones
  and rewrite the false alarms so the analysis comes back clean.
- **Objective:**
  - Linear string handling in place of the four super-linear regexes.
  - `npm ci --ignore-scripts` in the Dockerfile and CI. Only the approved Prisma packages run
    their scripts, through `npm rebuild`.
  - An explicit Docker `COPY` list.
  - A checked and encoded GitLab member path.
  - A clearer worker loop with no floating promise.
  - A test fake API that never echoes input.
- **Detail:**
  - `.sonarcloud.properties` marks `src/` as sources and `test/` as tests for automatic analysis.
  - No new CI workflow.
  - The quality gate needs a "new code" setting in SonarCloud, which the owner sets.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/sonar-fixes` | `.agents/` | |
| 2 | Sonar fixes | Regexes, Docker, CI, GitLab path, worker, test fake | git-server-agents | `fix/sonar-fixes` | `src/`, `test/`, `Dockerfile`, `.github/` | |
| 3 | Release | 1.4.1 changelog and version | git-server-agents | `release/1.4.1` | `wiki/logs/`, `package.json` | |
