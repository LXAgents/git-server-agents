---
name: prisma-6
description: Why the project pins Prisma 6 instead of the latest major.
---

# Pin Prisma 6

## 2026-10-31

Prisma 7 no longer accepts `url` inside the `datasource` block (it moved to
`prisma.config.ts`). The requested schemas use `url = env("DATABASE_URL")` and
`url = "file:./dev.db"`, so `prisma` and `@prisma/client` are pinned to `^6.19.3`, which
supports that form. Moving to 7 means moving the URL into a config file for both schemas.

## 2026-10-31 (superseded)

1.1.1 moved to Prisma 7.10.1: the URL lives in `prisma.config.js` and `src/db.js` uses a driver
adapter. 1.1.2 switched the SQLite adapter from `better-sqlite3` to `libsql`, which ships
prebuilt binaries and so needs no native build or `prebuild-install`.
