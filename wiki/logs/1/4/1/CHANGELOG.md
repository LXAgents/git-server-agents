# 1.4.1 — 2026-10-31

Fixes for the SonarCloud findings. Nothing changes for users.

## Added

- `.sonarcloud.properties`, so automatic analysis treats `src/`, `scripts/` and `prisma/` as
  sources and `test/` as tests.
- `src/utils/strings.js` with `trimTrailingSlashes()`, plus tests for it, the footer strip and
  the GitLab ID check.

## Changed

- **Linear string handling.** These used to take quadratic time on crafted input and now take
  linear time:
  - The trailing-slash trims in `config.js` and `repoTools.js`.
  - The `Authorization: Bearer` parse, which now requires a token without spaces.
  - The "Model:" footer strip in the chat history.
- **Install scripts.** `npm ci --ignore-scripts` in the Dockerfile and CI. Only `prisma` and
  `@prisma/engines`, which are already approved in `allowScripts`, run their scripts, through
  `npm rebuild`.
- **Docker** copies only `src/`, `prisma/`, `scripts/`, `prisma.config.js` and
  `docker-entrypoint.sh`.
- **GitLab member lookup.** The user ID must be a plain number and is URL-encoded. Anything
  else counts as "not an owner".
- **Worker.** The drain loop stops with a `break` after each batch, and its promises are explicitly not awaited.

## Fixed

- The test fake API no longer echoes query input.
