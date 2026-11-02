# 1.21.0 — 2026-11-02

The agent gets several sessions in a room, each with its own `AGENTS.md` and `MEMORY.md`,
several people can ask it in the same session, and it can create, rename and delete sessions.

## Added

- **Agent sessions.** `ChatSession.kind` is `chat` (team chat) or `agent` (Agent work). A room
  keeps its "Agent activity" session and may have any number of agent sessions; every message
  in one is for the agent. `POST /api/chat/sessions` takes `kind`, `GET /api/chat/sessions`
  takes `kind` to list one kind, and the new `GET /api/chat/sessions/:id` returns one session.
- **AGENTS.md and MEMORY.md** per agent session (up to 20,000 characters each), changed with
  `PATCH /api/chat/sessions/:id` (`agentsMd`, `memoryMd`). AGENTS.md (people's instructions)
  and MEMORY.md (the agent's notes, as data) go into the agent's prompt.
- **Session tools** for the chat agent, in every room: `list_sessions`, `create_session`,
  `rename_session`, `delete_session`, and in agent sessions `update_memory` and
  `update_agents_md`. They follow the API's rules, acting as the asker.
- A live `session` event when a session is created, renamed, changed or deleted, so every open
  page refreshes its lists. Progress events carry `data.asker`.

## Changed

- A question asked while the agent answers in the same session now waits its turn (up to five,
  `agent: "queued"`) instead of being refused; each is answered with its own asker's access and
  keys. History stops at each question, so later questions are not shown to it.
- Organization and personal rooms now give the agent tools (the session tools).

## Security

- In a repository room only people with write access may change AGENTS.md, since it is
  instructions to an agent that may hold a writer's tools. MEMORY.md is shown to the agent as
  notes, never instructions.

## Upgrade

- Run `npm run db:push`: three new `ChatSession` columns (`kind` with a default, `agentsMd`,
  `memoryMd`). Existing sessions stay team chats; the Agent activity session counts as an
  agent session.
