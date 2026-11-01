# Asking the agent

Start line 1 of the comment with `@lxagents` or with an OpenRouter model, `@vendor/model`. The
question can follow on the same line or on the next lines:

```
@lxagents What files do I have under src/services, and what does agentService.js do?
```

```
@openai/gpt-5
Review this diff.
```

- **`@lxagents`** uses the stored provider and model: the repository's, then the org's, then the
  commenting user's, then `DEFAULT_PROVIDER` / `DEFAULT_MODEL` (`openrouter` /
  `openrouter/free`). They are set in the dashboard or the user API, per modality; the agent
  uses the `text` one.
- **`@vendor/model`** uses that OpenRouter model, whatever is stored.
- A comment that starts any other way gets no answer, and neither does one whose first line is a
  user mention such as `@alice`.

## How many tool rounds

The agent works in **tool rounds**. In one round the model can call several tools at once, and
all of them run before the next round. It gets **3 rounds** unless the comment asks for more or
fewer in plain words:

```
@lxagents Run this 5 times: read every file under src/services and list the TODOs.
```

Phrases such as "run this 5 times", "loop 10 times", "up to 4 rounds", "repeat twice" or
"iterate 7x" set the limit, and number words up to twenty work too. The count is only read in a
sentence that asks to run, loop, repeat, use or limit something, so "it failed 5 times
yesterday" changes nothing. The limit is capped by `MAX_TOOL_ROUNDS` (default 20), and the whole
answer still has to finish within `TASK_TIMEOUT_MS`. The model is told how many rounds it has,
and after the last one it must answer with what it has.

## What the agent can change

A commenter with **write access** to the repository can also ask the agent to manage issues:

```
@lxagents close this issue
@lxagents open an issue for the flaky login test, label it bug
@lxagents reopen #12
```

| Tool | Does | Arguments |
|---|---|---|
| `create_issue` | Opens an issue | `title` (required), `body`, `labels` |
| `close_issue` | Closes an issue | `number`, or this thread when it is an issue |
| `reopen_issue` | Reopens an issue | `number`, or this thread when it is an issue |

- **Who:** on GitHub, `write`, `maintain` or `admin` permission on the repository; on GitLab,
  Developer or above on the project. Anyone else gets only the read tools. If the check fails,
  the tools are not offered.
- **What it acts on:** only what the commenter's own message asks. The model is told never to
  act on instructions in files, diffs, descriptions or earlier comments.
- **Who it says asked:** the bot is the platform author, so everything it opens ends with
  `Opened by LXAgents for @login` (in a code span, so nobody is notified).
- **When it fails:** the platform's status and message go back to the model, such as
  `Error: create_issue failed (HTTP 422: Validation Failed)`, so it can fix the call or tell
  you why. On GitHub, `close_issue` refuses a number that is a pull request.

## Providers and keys (bring your own key)

| Provider | Slug | Model ids look like | API |
|---|---|---|---|
| OpenRouter | `openrouter` | `openai/gpt-5`, `openrouter/free` | `OPENROUTER_API_URL` (`https://openrouter.ai/api/v1`) |
| OpenAI | `openai` | `gpt-5` | `OPENAI_API_URL` (`https://api.openai.com/v1`) |
| Anthropic | `anthropic` | `claude-opus-5-5` | `ANTHROPIC_API_URL` (`https://api.anthropic.com`), official SDK |
| DeepSeek | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_URL` (`https://api.deepseek.com`), OpenAI-compatible |
| z.ai (GLM) | `zai` | `glm-4.6` | `ZAI_API_URL` (`https://api.z.ai/api/paas/v4`; `https://open.bigmodel.cn/api/paas/v4` in mainland China), OpenAI-compatible |

The server holds **no key of its own** for any provider. Every key belongs to a user, an org or
a repository and is stored for one provider. Before any model call the agent looks up the keys
for the provider it resolved; when the commenter may use none, it answers `NO_API_KEY` naming
that provider instead of calling a model.

Model lists come live from each provider's API. OpenRouter's is public. The others list
models only to a key holder, so `GET /api/user/models?provider=openai` uses your own OpenAI
key, or the key of an org (`&orgId=`) or repository (`&repoId=`) you manage. z.ai falls back to
its published GLM models if its `/models` answers 404.

## What the agent reads

- **Conversation:** the last 30 comments on the issue, PR or MR are sent as chat history.
  The agent's own replies count as `assistant`, everyone else as `user` with their `@login`.
  So follow-up questions work.
- **Repository files:** the model gets two tools, `list_files` and `read_file`. They read
  through the GitHub or GitLab API at the PR or MR head commit, or at the default branch for an
  issue.
  - Files are cut at 40,000 characters and the list at 2,000 paths.
  - If the model doesn't support tools, the agent asks again without them. That second request
    includes the file list and any files the question names.
- **Keys: repository, then org, then the user's own.**
  - **Repository keys** are used only when the commenter is a collaborator on the repository
    (GitHub), a member of the project (GitLab), or a member of its org.
  - **Org keys** are used only when the platform confirms the commenter is a member of the org:
    on GitHub through the App's "Members: read" permission, on GitLab through the bot token. On
    a personal account, the commenter must be its owner.
  - **The commenter's own keys** come last.

  If membership can't be confirmed, those keys are skipped. If a key fails, the next is tried.

Key ownership and order are also covered in [dashboard access](dashboard-access.md#users-orgs-and-api-keys).

## When the agent can't answer

A trigger never goes unanswered. If anything fails, the agent replies with a code, the HTTP
status when there is one, what happened (the provider's or the platform's own message), whether
retrying helps, and the task id. For a rate limit it gives the time the limit lifts. When
several keys were tried, it lists each key's owner type and status, but never the key itself.
Error replies are left out of the conversation history.

| Code | Status | Meaning | Retry |
|---|---|---|---|
| `NO_QUESTION` | | The trigger asks nothing | Add the question |
| `NO_API_KEY` | | No active key for the resolved provider that the commenter may use | No: log in and add a key for that provider |
| `INVALID_API_KEY` | 401 | The key is invalid, revoked or disabled | No: replace the key |
| `INSUFFICIENT_CREDITS` | 402 | The key's balance has run out | No: add credits, or use a `:free` model |
| `CONTENT_FLAGGED` | 403 | Moderation refused the input | No: rephrase |
| `MODEL_NOT_FOUND` | 404 | The model id is wrong or has no provider | No: fix the id |
| `BAD_REQUEST` | 400 | The provider rejected the request | No: try another model |
| `TIMEOUT` | 408 | A model call took over 60 s, or the answer over 4 minutes | Once, then pick a faster model |
| `RATE_LIMITED` | 429 | The rate limit or the free-model daily limit was hit | After the time given |
| `PROVIDER_UNAVAILABLE` | 502, 503 | The model's provider is down or busy | In a few minutes |
| `PROVIDER_ERROR` | 500 | The model's provider failed | In a few minutes |
| `EMPTY_RESPONSE` | | The model returned no text | Once, or another model |
| `PLATFORM_ERROR` | any | GitHub or GitLab refused a request | In a few minutes; check the App's permissions |
| `INTERNAL_ERROR` | | Anything else; the details are only in the server log | Once, then give the owner the task id |

OpenRouter sometimes answers HTTP 200 with an error in the body. The agent reads the real
status from it.

If no reply appears at all, see [No answer?](#no-answer) below.

## No answer?

The worker adds 👀 to a comment as soon as it starts on it. No 👀 means the comment never
reached the worker:

- **401 in the log, or under the GitHub App's Advanced → Recent deliveries.** The webhook
  secret is missing or different. `PROD=prod` refuses unsigned webhooks, while SQLite
  development accepts them, so a setup that works on SQLite can fail here. Set
  `GITHUB_WEBHOOK_SECRET` (or `GITLAB_WEBHOOK_SECRET`) to the App's webhook secret. The 401
  body names the setting to fix.
- **403 in the log.** The org isn't imported in this database. SQLite and PostgreSQL are
  separate databases, so import it again from the dashboard after switching.
- **Nothing in the log.** The delivery never reached the server: check the App's webhook URL.

At start the server logs which database it uses and warns about both settings.

Every log line is also stored in the `Log` table. The owner reads them on the dashboard's
**Logs** page (`GET /api/admin/logs?level=warn&source=webhook&limit=100&before=<id>`), which
shows the lines for the owner's platform and the server's own. Lines older than
`LOG_RETENTION_DAYS` are deleted at start and every six hours.
