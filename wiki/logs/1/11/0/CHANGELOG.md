# 1.11.0 — 2026-10-31

## Added

- **👀 on pickup.** The worker puts an eyes reaction on a trigger comment as soon as it starts
  on it. On GitLab that is the note's award emoji.
- **Cost line.** Every answer ends with `Cost: … USD` under the model line. It is the total of
  every OpenRouter call the answer took, as OpenRouter reports it (`0 USD` for free models).
- **Logs for each step:** each webhook and its outcome, the worker's claim and result, and
  each model call, all with durations.
- **Open login.** Anyone with a GitHub or GitLab account can log in. There is no whitelist and
  no sign-up step: the first login creates the account.

## Changed

- **Role `member` is now `free`.** `scripts/migrate-roles.js` renames the stored rows at start.
- **Answers run in parallel and in bounded time:**
  - up to `WORKER_CONCURRENCY` (4) at once;
  - `MODEL_TIMEOUT_MS` (60 s) per model call and `TASK_TIMEOUT_MS` (4 min) per answer;
  - 3 tool rounds instead of 5.
- **GitHub and GitLab API calls** time out after `PLATFORM_TIMEOUT_MS` (30 s).
- **Webhooks:**
  - only new trigger comments are queued; anything else answers `ignored`;
  - the commenter needs no account, but the org must still be imported.

## Removed

- The whitelist check at login and at webhooks, and the `NOT_WHITELISTED` reply.

Deploy with git-client-agents 1.10.0.
