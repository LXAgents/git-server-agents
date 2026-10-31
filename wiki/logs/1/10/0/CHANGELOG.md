# 1.10.0 — 2026-10-31

## Added

- **Error replies.** A triggered comment that can't be answered now gets a reply instead of
  silence. The reply has:
  - a code;
  - the HTTP status;
  - OpenRouter's or the platform's own message;
  - whether to retry, with the reset time for rate limits;
  - which keys were tried (owner type and status only);
  - the task id.

  The codes are `NO_QUESTION`, `NOT_WHITELISTED`, `NO_API_KEY`, `INVALID_API_KEY`,
  `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `MODEL_NOT_FOUND`, `BAD_REQUEST`, `CONTENT_FLAGGED`,
  `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_ERROR`, `EMPTY_RESPONSE`, `PLATFORM_ERROR` and
  `INTERNAL_ERROR`. Error replies stay out of the conversation history.
- **Not-whitelisted notice.** A trigger from someone who isn't whitelisted, in an imported
  org, gets a `NOT_WHITELISTED` reply. Orgs nobody imported still get nothing.

## Changed

- OpenRouter errors returned inside an HTTP 200 body are read with their real status, instead
  of as an empty answer.
- A trigger with no question gets `NO_QUESTION` instead of being skipped.
- The package is renamed `@lxagents/git-server-agents`.

## Fixed

- Tasks left in `processing` by a restart or redeploy go back to `pending` when the worker
  starts (after 30 minutes).

## Removed

- **Personal access tokens can't sign in.** Tokens starting `ghp_`, `github_pat_` or `glpat-`
  get 401. Use Continue with GitHub or GitLab (git-client-agents 1.9.0).
