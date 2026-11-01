# Webhooks and the worker

1. `POST /api/webhooks/github` or `/gitlab` checks the signature (`X-Hub-Signature-256`
   HMAC or `X-Gitlab-Token`). Bad signature: **401**.
2. Anything other than a new comment whose line 1 is a trigger (see below) answers **200**
   `{ "status": "ignored" }` and is not stored.
3. The org must be imported (`AppInstallation`) for that App installation; otherwise **403**,
   and the agent never acts there. The apps are public, so this is the gate. The commenter
   needs no account: which keys they may use is decided per comment.
4. The payload is stored as a `pending` `AgentTask` and the request returns **200** at once.
   Every webhook is logged with its outcome (`ignored`, `403 <reason>` or `queued task <id>`).
5. The worker claims the task and puts 👀 on the comment, so the commenter sees it was picked
   up. It re-checks the org, then fetches the diff (PRs and MRs only) and the last 30 comments.
   It calls the provider and posts the reply. The task ends as `success`, `skipped` or `failed`
   (see `errorLog`). A failed task also gets an error reply on the thread (see below).
   - Up to `WORKER_CONCURRENCY` (4) comments are answered at once, so a slow one doesn't hold
     up the rest.
   - Each model call has `MODEL_TIMEOUT_MS` (60 s), and a whole answer has `TASK_TIMEOUT_MS`
     (4 minutes, every call, tool and key together). Past that it replies `TIMEOUT`.
   - GitHub and GitLab calls time out after `PLATFORM_TIMEOUT_MS` (30 s).
6. When the worker starts, tasks left in `processing` for over 30 minutes (by a restart or a
   redeploy) go back to `pending`.

## Replies

The answer is posted back as a reply, with a footer naming the model and its provider, what the
answer cost in US dollars (every OpenRouter call it took, added up; `0 USD` for free models;
`unknown` for the other providers, which report no cost), and the
commenter who asked (their username, as `@name` in a code span, so nobody is notified).

Every reply ends with the hidden marker `<!-- LXAgents -->` (error replies also carry
`<!-- LXAgents:error -->`), so the agent never answers itself. Replies from before 1.11.1, with
`<!-- git-server-agents -->`, are still recognised. Repositories are never cloned: diffs, comments and files
all come from the REST APIs.
