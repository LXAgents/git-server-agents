# Setup

Needs Node.js 22.22.2+, 24.15+ or 26 (`.nvmrc` pins 26 LTS, which CI uses: `nvm use`).

```bash
cp .env.example .env              # fill in secrets, see configuration
npm install
npm run db:push                   # copies the schema for PROD, creates the tables, generates the client
npm run db:seed                   # adds the five AI providers (no keys)
npm run dev                       # server + worker on SQLite, restarts on changes (node --watch)
```

`PROD=prod` switches to PostgreSQL (`prisma/schema.prod.prisma`, `DATABASE_URL`); empty or
`dev` uses SQLite at `prisma/dev.db`. `scripts/setup-db.js` copies the right file to
`prisma/schema.prisma` before `dev`, `start` and `db:push`. Prisma 7 takes the connection URL
from `prisma.config.js` and connects through a driver adapter (`libsql` or `pg`), picked
the same way in `src/db.js`.

Every variable is listed in [configuration](../reference/configuration.md). The dashboard sign-in needs OAuth apps too: see [dashboard access](dashboard-access.md).

## GitHub App and GitLab bot

The GitHub App needs these repository permissions:

- **Contents: read**, for files.
- **Issues: read and write** and **Pull requests: read and write**, for comments and diffs.
- **Metadata: read** (every App has it), to check repository collaborators.
- **Members: read**, an organization permission.

The GitLab bot token needs the `api` scope (or `read_api` plus permission to post notes).
