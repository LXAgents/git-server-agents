# 1.2.0 — 2026-10-31

The server now ships as a Docker image that runs on any platform that deploys a Dockerfile.

## Added

- A root `Dockerfile`:
  - Based on `node:26-slim`, with production dependencies only.
  - Runs as the `node` user.
  - Listens on `PORT` (default 3000).
  - Has a health check on `/health`.
- `docker-entrypoint.sh`, which prepares the database on every start: it picks the schema from
  `PROD`, generates the client, runs `prisma db push` and seeds the provider. An empty database
  works on first boot.
- `.dockerignore`.
- A "Run with Docker" section in the README.

## Changed

- `prisma` is now a regular dependency, because the container runs the CLI at start.

## Notes

- On a platform, use `PROD=prod` with a managed PostgreSQL. Platform disks are usually wiped on
  redeploy, which would erase a SQLite file. To keep SQLite, mount a volume at `/app/prisma`.
- Set `CORS_ORIGINS` to the dashboard's public URL.
