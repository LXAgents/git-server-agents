# Configuration

Every setting is an environment variable, read from `.env` in development or from the platform in production. `.env.example` lists them all.

| Variable | Purpose |
|---|---|
| `PROD` | `prod` for PostgreSQL, otherwise SQLite |
| `DATABASE_URL` | PostgreSQL connection string (prod) |
| `GITHUB_WEBHOOK_SECRET`, `GITLAB_WEBHOOK_SECRET` | Webhook authenticity; required in prod |
| `GITHUB_CLIENT_ID`, `GITHUB_PRIVATE_KEY` | The GitHub App's client ID and private key. They mint installation tokens to read diffs and post comments |
| `GITHUB_CLIENT_SECRET` | The GitHub App's client secret, for "Continue with GitHub" on the dashboard |
| `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` | A GitLab OAuth application, for "Continue with GitLab" on the dashboard |
| `GITLAB_TOKEN`, `GITLAB_API_URL` | Bot token (api scope) and API base for GitLab. GitLab has no app-only OAuth token, so the bot keeps a token |
| `GITHUB_URL`, `GITLAB_URL` | Web addresses for OAuth (default `https://github.com`, and `GITLAB_API_URL` without `/api/v4`). Change them only for GitHub Enterprise or self-managed GitLab |
| `PUBLIC_URL` | This server's public address, used for the OAuth callback URL. Set it behind a proxy or on a platform |
| `ENCRYPTION_KEY` | 32-byte key for stored API keys (`node scripts/manage.js new-encryption-key`) |
| `DEFAULT_PROVIDER`, `DEFAULT_MODEL` | What `@lxagents` uses when no repository, org or user model is set (default `openrouter`, `openrouter/free`). The commenter still needs their own key for it |
| `OPENROUTER_API_URL`, `OPENAI_API_URL`, `ANTHROPIC_API_URL`, `DEEPSEEK_API_URL`, `ZAI_API_URL` | Each provider's API base URL (defaults in the [providers table](../guides/asking-the-agent.md#providers-and-keys-bring-your-own-key)); the seed stores them |
| `MAX_OUTPUT_TOKENS` | The longest answer a provider may write (default 16000; Anthropic requires a limit) |
| `WORKER_INLINE`, `WORKER_POLL_MS` | Run the worker in the server process, and its poll interval |
| `WORKER_CONCURRENCY` | How many comments are answered at once (default 4) |
| `MODEL_TIMEOUT_MS`, `TASK_TIMEOUT_MS` | Limits for one model call (default 60000) and one whole answer (default 240000) |
| `MAX_TOOL_ROUNDS` | The most tool rounds a comment may ask for, such as "run this 5 times" (default 20). A comment that names no number gets 3 |
| `WORKSPACE_TASK_TIMEOUT_MS` | The limit for one answer that may use the workspace tools, in place of `TASK_TIMEOUT_MS` (default 900000) |
| `WORKSPACE_BOOT_TIMEOUT_MS` | How long `create_workspace` waits for a codespace to become Available (default 300000) |
| `WORKSPACE_EXEC_TIMEOUT_MS` | The limit for one `exec_command` (default 300000) |
| `WORKSPACE_IDLE_TIMEOUT_MINUTES` | GitHub stops an idle codespace after this many minutes, 5 to 240 (default 10) |
| `WORKSPACE_KEEP_MINUTES` | How long the codespace an answer used last is kept for the next message of the same chat session or issue/pull request thread, 0 to 43200 (default 60; 0 deletes it when the answer ends). Also sent to GitHub as the retention period, so GitHub deletes it after a server restart |
| `GH_PATH` | The gh CLI used for `gh codespace ssh` (default `gh`; the Docker image installs it with an SSH client) |
| `PLATFORM_TIMEOUT_MS` | Limit for each GitHub or GitLab API call (default 30000) |
| `LOG_RETENTION_DAYS` | Days stored log lines are kept for the dashboard's Logs page (default 14) |
| `LOG_STORE` | `false` prints log lines without storing them |
| `GITHUB_ADMIN_ID`, `GITLAB_ADMIN_ID` | The **one** numeric GitHub or GitLab user ID that owns that platform (empty: no owner). A comma list stops the server at start |
| `CORS_ORIGINS` | Origins allowed to call the APIs, e.g. the dashboard (default `http://localhost:5173`) |
