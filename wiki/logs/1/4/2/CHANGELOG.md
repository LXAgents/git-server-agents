# 1.4.2 — 2026-10-31

The log can no longer be forged through webhook values. This fixes the SonarCloud
"Log Injection" finding.

## Added

- `logSafe()` in `src/utils/strings.js`. It turns control characters (CR, LF, tabs and ANSI
  escapes) into spaces and caps values at 200 characters.

## Changed

- These log lines now pass request-derived values through `logSafe()`:
  - The webhook 403 warning (the event and the whitelist reason).
  - The agent's "no tool support" and "could not confirm membership" warnings.
  - The worker's task lines.
