# Chat rooms

The dashboard's Chat page talks to `/api/chat`: three kinds of rooms, each with any number of
chat sessions, live updates over Server-Sent Events, and the agent answering in the room.

## Rooms

| Room | Who may join | The agent answers |
|---|---|---|
| `user:{accountId}` | Only you (your account id on the session's platform) | Every message |
| `repo:{repoId}` | Admins and collaborators of an imported repository | Messages starting with `@lxagents` (or `@vendor/model`) |
| `org:{orgId}` | Owners and members of an imported org | Messages starting with `@lxagents` (or `@vendor/model`) |

Every request asks GitHub or GitLab again, with your own OAuth token, whether you may be in the
room. An open stream checks again every five minutes and closes once you lost access.

## Sessions and messages

A room holds sessions (`ChatSession`: id, title, kind, who started it, timestamps). Each session keeps
its messages (`ChatMessage`: role `user` or `assistant`, type `message` or `report`, sender and
avatar, content, and the event's `data` as JSON). Posting without a session starts one titled
from the first line. In repo and org rooms only whoever started a session may delete it.

A session's `kind` is `chat` (the team chat pane) or `agent` (the Agent work pane). Every message
posted to an agent session is for the agent, in any room, with no `@lxagents` needed.

Each room has one "Agent activity" session (`activity: true`, kind `agent`). Reports of answers
to comments go there. Post to it with `sessionId: "activity"`. It cannot be renamed or deleted.
Any number of other agent sessions can be started next to it (`POST /sessions` with
`kind: "agent"`).

### AGENTS.md and MEMORY.md

Every agent session has its own two files, up to 20,000 characters each, read with
`GET /sessions/:id` and changed with `PATCH /sessions/:id`:

- **AGENTS.md**: the people's instructions for the agent in this session ("answer in Thai",
  "always open a pull request"). It goes into the agent's prompt. In a repository room only
  people with write access may change it, because a reader's instructions must not steer a
  writer's tools.
- **MEMORY.md**: the agent's notes for later answers in this session. It goes into the prompt as
  notes (data, not instructions), and the agent keeps it current with its `update_memory` tool.
  Anyone in the room may change it.

### Several people in one session

Everyone who may join a repository or organization room sees its sessions live and may post in
them. While the agent answers one question in a session, later questions wait in order (up to
five; `agent: "queued"`) instead of being refused, and each is answered with its own asker's
access and keys. A sixth waiting question is refused with a message (`agent: "busy"`).

## Events

The stream (`GET /api/chat/stream?room=...`) sends every event of every session in the room as
`data: <json>` lines:

```json
{ "type": "message", "room": "repo:ck...", "sessionId": "ck...", "sender": { "id": "1001", "login": "alice", "type": "user", "avatarUrl": "https://..." }, "content": "...", "timestamp": "2026-11-01T21:00:00.000Z" }
```

`avatarUrl` is there when the platform gave one. The agent's answers and reports carry
`data: { model, provider, cost, usage }`, where `usage` is
`{ costUsd, costComplete, inputTokens, outputTokens, tokensComplete }`, counted from the
provider's reply (OpenRouter, OpenAI, DeepSeek and Anthropic report tokens; others may not).

- `message`: a person or the agent wrote something (stored).
- `report`: the agent finished something, such as an answer to a comment (stored).
- `progress`: what the agent is doing, with `data: { status, tool }`, for example
  `{ "status": "Creating GitHub Codespace...", "tool": "create_workspace" }` (live only).
- `token`: a piece of the agent's answer while it is written (live only).
- `session`: a session was created, renamed, changed or deleted, by a person or the agent, with
  `data: { action: "created" | "renamed" | "updated" | "deleted", session }` (live only).
  Refresh the session lists. Progress events of an answer carry `data.asker`, the login being
  answered.

Read the stream with `fetch` and the `Authorization` header; `EventSource` cannot send it, and
the token never goes in a URL.

## Answers to comments in the chat

When the agent answers a comment, the commenter's user room and the repository's room (when the
repository is imported) see it live: an "Answering @login on owner/repo#12" progress event, a
progress event per tool call, the answer's text as `token` events, and a `report` with the
final answer (or the error reply) stored in the room's "Agent activity" session. The text is
streamed from the provider only while someone has one of those rooms open; otherwise the
provider is asked exactly as before.

A `progress` event with `data.reset: true` starts a new model call: clear the text streamed so
far. The stored `message` or `report` that follows is the final text.

## Room summary

`GET /api/chat/summary?room=...` is for the Chat page's details pane, and anyone who may read the
room may read it:

```json
{
  "room": { "room": "repo:ck...", "kind": "repo", "name": "acme/web", "platform": "github" },
  "model": { "provider": "openai", "providerName": "OpenAI", "model": "gpt-5", "source": "repo" },
  "keys": {
    "ai": { "repo": 1, "org": 0, "user": 2, "total": 3 },
    "workspace": { "provider": "github_codespaces", "providerName": "GitHub Codespaces", "repo": 0, "org": 1, "user": 0, "total": 1 }
  },
  "stats": { "answers": 12, "inputTokens": 48210, "outputTokens": 3920, "costUsd": 0.0841, "costComplete": false, "tokensComplete": true, "answersWithoutUsage": 2, "capped": false }
}
```

The model and key counts are what the agent would use for you in this room (org keys only for
org members). Keys are counted, never read. `workspace` is null on GitLab. `stats` adds up the
newest 5000 answers and reports; answers stored before 1.19.0 and error replies count in
`answersWithoutUsage`.

## How the agent answers

The provider, model and keys follow the room: repo room → the repository's, then the org's (for
org members), then yours; org room → the org's, then yours; user room → yours. A repo room also
gives the agent the same tools as an answer to a comment (see [Asking the agent](asking-the-agent.md)):

- `list_files` and `read_file` at the default branch, for everyone in the room.
- `read_issue`, `read_pull_request`, `list_commits` and `read_commit` for the issues, pull requests
  (merge requests on GitLab) and commits your message mentions.
- For members with write access (GitHub write, maintain or admin; GitLab Developer or higher),
  checked again for every message: `create_issue`, `close_issue`, `reopen_issue`,
  `create_pull_request`, `close_pull_request` and `reopen_pull_request`. A room has no issue of
  its own, so closing or reopening one needs its number. Readers are told they cannot change
  anything.
- On GitHub, for writers with a workspace key, the workspace tools.

Organization and personal rooms have no repository, so the agent has no repository tools there.

In every room the agent also has the session tools, acting as the asker under the same rules as
the API: `list_sessions`, `create_session` (an agent or chat session), `rename_session` and
`delete_session` (only when asked; never the Agent activity session or the session being
answered). In an agent session it also has `update_memory` (append or replace MEMORY.md) and,
for people who may change it, `update_agents_md`.

One answer at a time per session; later questions wait (see above).

## Limits

Live events reach streams in the same process. With the worker in its own process
(`WORKER_INLINE=false`), stored messages still show but live progress from comment answers does
not.
