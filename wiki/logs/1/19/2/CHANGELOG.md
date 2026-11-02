# 1.19.2 — 2026-11-02

Commands the agent ran in a GitHub Codespace only ran their first word. `npm init -y` ran as
`npm`, so npm printed its usage and exited 1; one-word commands such as `ls` worked.

## Fixed

- `run_command` sends the command to `gh codespace ssh` as one quoted `bash -lc '...'` string.
  ssh joins separate arguments with spaces and the codespace's shell splits them again, so
  `bash`, `-lc` and the command can't be passed as separate arguments. Quotes, `&&`, `;`, `$HOME`
  and newlines now reach the codespace as written.

No schema, API or setting change.
