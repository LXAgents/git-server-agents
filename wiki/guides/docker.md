# Run with Docker

The root `Dockerfile` builds one image with the server and the worker. It needs no build
arguments. Every setting is an environment variable from [configuration](../reference/configuration.md), and it listens on
`PORT` (default 3000), so it runs on any platform that deploys a Dockerfile (Render, Railway,
Fly.io, Cloud Run, Koyeb and others).

```bash
docker build -t git-server-agents .
docker run -p 3000:3000 --env-file .env git-server-agents
```

On every start, `docker-entrypoint.sh` does the following, then starts the server:

1. Picks the schema for `PROD`.
2. Generates the Prisma client.
3. Runs `prisma db push`, which creates or updates the tables. It stops instead of dropping data.
4. Seeds the five AI providers.

So an empty database is ready on first boot, with no shell needed. `/health` drives the
container health check.

- **Use PostgreSQL on a platform.** Most platforms wipe the container's disk on every deploy,
  which would erase a SQLite file. Set `PROD=prod` and `DATABASE_URL` to the platform's managed
  PostgreSQL. To keep SQLite anyway, mount a persistent volume at `/app/prisma`.
- **Set at least these:**
  - `ENCRYPTION_KEY`, `GITHUB_ADMIN_ID` and `GITLAB_ADMIN_ID`.
  - The webhook secrets. They are required when `PROD=prod`.
  - The GitHub App or GitLab credentials, including the client IDs and secrets for sign-in.
  - `PUBLIC_URL`, set to the server's public URL.
  - `CORS_ORIGINS`, set to the dashboard's public URL.
- **Users log in with GitHub or GitLab**; the owner sees them on the dashboard's Users page,
  or with the CLI in the running container: `docker exec <container> node scripts/manage.js list`. Platforms offer the same through their
  shell or console.
- **To split the worker out,** run a second service from the same image with the command
  `node src/worker.js`, and set `WORKER_INLINE=false` on the web service.
