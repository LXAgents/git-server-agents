---
name: oauth-code-exchange
description: Task record for returning a sealed one-time code instead of the OAuth token in the URL (1.5.0).
status: in-progress
---

# OAuth code exchange

## Goal / Objective / Detail

- **Goal:** the OAuth user token never appears in a URL. This clears the last SonarCloud
  finding (dashboard storage poisoning), which the owner reported again on 2026-10-31.
- **Objective:**
  - The callback returns `#code=<sealed>`: the platform and token, AES-256-GCM, valid for 60
    seconds.
  - `POST /api/auth/exchange` turns that code into `{ platform, token }`, once.
- **Detail:**
  - The code is sealed with `ENCRYPTION_KEY` through `cryptoService`.
  - Used codes are remembered in memory until they expire.
  - Breaking for dashboards older than 1.3.0.

## Tasks

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This record | git-server-agents | `plan/oauth-code-exchange` | `.agents/` | |
| 2 | Code exchange | Sealed code, exchange endpoint, tests, README | git-server-agents | `feat/oauth-code-exchange` | `src/`, `test/`, README | |
| 3 | Release | 1.5.0 changelog and version | git-server-agents | `release/1.5.0` | `wiki/logs/`, `package.json` | |
