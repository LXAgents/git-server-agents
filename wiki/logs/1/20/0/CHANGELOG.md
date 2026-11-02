# 1.20.0 — 2026-11-02

The agent keeps its codespace between messages. Before, every answer deleted its codespace when
it ended, so the next prompt waited minutes for a new one and lost the earlier work.

## Added

- The codespace an answer used last stays open for `WORKSPACE_KEEP_MINUTES` (new, default 60)
  and the next message in the same chat session, or the next comment on the same issue or pull
  request, reuses it with the earlier work in it. `create_workspace` returns it (`reused: true`)
  instead of starting a new one, and the tool guide names it.
- A kept codespace GitHub stopped for being idle is started again before the next command; one
  that no longer exists is forgotten and the agent is told to create a new one.
- Codespaces are created with `retention_period_minutes` equal to `WORKSPACE_KEEP_MINUTES`, so
  GitHub deletes them by itself after they stop, even if the server restarts.

## Security

- Only an answer for the same repository, asked by someone who may use the same workspace key,
  can pick up a kept codespace. Keys stay handles; the token is decrypted only for each call.

## Changed

- Other codespaces still open are deleted when the answer ends, as before.
  `WORKSPACE_KEEP_MINUTES=0` keeps the old behaviour (delete everything at the end).

No schema or API change.
