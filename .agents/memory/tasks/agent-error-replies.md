---
name: agent-error-replies
description: Task record for error replies from the agent, refusing personal access tokens, and the scoped package name (1.10.0).
status: done
---

# Agent error replies

## Goal / Objective / Detail

- **Goal:** on 2026-10-31 the owner reported that the agent gave no answer to its triggers. They
  asked for every failure to come back as a code and a message, so users know what happened
  and don't just retry.
- **Objective:**
  - A failed task posts an error reply with a stable code, the HTTP status, and retry advice.
    The codes cover a missing key, an invalid key, credits, rate limits, the model, timeouts,
    provider errors, the platform, and not being whitelisted.
  - OpenRouter 200 responses that carry an error are read as errors.
  - Stale `processing` tasks are queued again.
  - Personal access tokens are refused at sign-in.
  - The package is renamed `@lxagents/git-server-agents`.
- **Detail:** comments in orgs nobody imported stay silent, because the app is public.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/agent-error-replies` | `.agents/` | #50 |
| 2 | Error replies | Error codes, replies, notices, stale tasks, PAT refusal, package name | git-server-agents | `feat/agent-error-replies` | `src/`, `test/`, `README.md`, `package.json` | #51 |
| 3 | Release | 1.10.0 changelog and version | git-server-agents | `release/1.10.0` | `wiki/logs/`, `package.json` | #52 |
