# 1.5.0 — 2026-10-31

The OAuth token never goes into a URL. Needs git-client-agents 1.3.0.

## Added

- **`POST /api/auth/exchange`** with `{ "code": "…" }` answers `{ platform, token }`.
  - Each code works once.
  - A bad, expired or reused code gets a 400.
  - The response is sent with `Cache-Control: no-store`.

## Changed

- **Breaking:** after "Continue with GitHub/GitLab", the callback sends the browser back with
  `#code=<sealed>` instead of `#platform=…&token=…`.
  - The code is the platform and token encrypted with AES-256-GCM under `ENCRYPTION_KEY`, and
    it expires after 60 seconds.
  - Dashboards older than 1.3.0 can't finish an OAuth sign-in. Pasted tokens still work.
