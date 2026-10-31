# 1.1.1 — 2026-10-31

Every dependency moved to its latest stable release. No API or schema change.

## Changed

- Prisma 6.19.3 → 7.10.1 (`prisma` and `@prisma/client`). Prisma 8 is still a release
  candidate, so it is not used.
- The database URL now lives in `prisma.config.js`. The schemas only name the provider.
- The client connects through a driver adapter: `@prisma/adapter-better-sqlite3` for SQLite
  and `@prisma/adapter-pg` for PostgreSQL, chosen by `PROD` as before.
- `npm run db:push` also generates the client, which Prisma 7 no longer does on push.
- Node.js 22.12 or later is required.

## CI

- Node 26 LTS, `actions/checkout` v7, `actions/setup-node` v7 and PostgreSQL 18.

## Upgrading

Run `npm install` and then `npm run db:push`. Existing databases keep their data.

## Known

- `npm audit` reports a moderate issue in `minimatch` through `nodemon`. It affects the
  development watcher only, and the latest `nodemon` (3.1.14) is already installed.
