# 1.1.2 — 2026-10-31

`npm install` runs clean: no deprecation warning, no unapproved install scripts and 0
vulnerabilities, on npm 11 and npm 12.

## Changed

- The SQLite adapter is now `@prisma/adapter-libsql`, which replaces
  `@prisma/adapter-better-sqlite3`. libsql ships prebuilt binaries, so the native build and the
  deprecated `prebuild-install` are gone. PostgreSQL is unchanged.
- `npm run dev` uses Node's built-in `node --watch` instead of `nodemon`. This removes the
  moderate `minimatch` advisory.
- `package.json` `allowScripts` approves the install scripts of `prisma` and `@prisma/engines`
  at 7.10.1. npm 12 blocks unapproved install scripts by default.
- Node.js `^22.22.2 || ^24.15.0 || >=26` is required, matching the dependencies. `.nvmrc` pins 26
  LTS.

## Upgrading

1. Switch to Node 26 with `nvm install` (or `nvm use`), or use any supported version above.
2. Run `npm install`, then `npm run db:push`.

Existing `prisma/dev.db` files keep working.
