# 1.14.0 — 2026-11-01

## Breaking

- **The trigger is now `@lxagents`.** A comment whose line 1 starts with `@lxagents` (any case) is answered with the stored provider and model. Comments that start with `@agents` are skipped like any other comment. Tell your users before you deploy.

## Unchanged

- `@vendor/model` on line 1 still asks one OpenRouter model.
- The API, env vars and schema. Deploy with git-client-agents 1.13.0, whose help text names the new trigger.
