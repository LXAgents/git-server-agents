# 1.18.1 — 2026-11-02

The chat stream's log line can no longer be forged through the room query. This fixes the
SonarCloud "Log Injection" finding in `chatController.js`.

## Changed

- These log lines now pass outside values through `logSafe()`:
  - "stream opened on a … room" in the chat stream (the room kind from `?room=`).
  - The workspace key refusal warning (the error code from the Codespaces call).
  - The chat "could not send an event" warning (the error message).

No schema, API, setting or permission change.
