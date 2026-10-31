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
