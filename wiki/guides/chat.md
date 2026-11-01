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

A room holds sessions (`ChatSession`: id, title, who started it, timestamps). Each session keeps
its messages (`ChatMessage`: role `user` or `assistant`, type `message` or `report`, sender,
content). Posting without a session starts one titled from the first line. In repo and org
rooms only whoever started a session may delete it. Reports of answers to comments go to the
room's "Agent activity" session.

## Events

The stream (`GET /api/chat/stream?room=...`) sends every event of every session in the room as
`data: <json>` lines:

```json
{ "type": "message", "room": "repo:ck...", "sessionId": "ck...", "sender": { "id": "1001", "login": "alice", "type": "user" }, "content": "...", "timestamp": "2026-11-01T21:00:00.000Z" }
```

- `message`: a person or the agent wrote something (stored).
- `report`: the agent finished something, such as an answer to a comment (stored).
- `progress`: what the agent is doing, with `data: { status, tool }`, for example
  `{ "status": "Creating GitHub Codespace...", "tool": "create_workspace" }` (live only).
- `token`: a piece of the agent's answer while it is written (live only).

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

## How the agent answers

The provider, model and keys follow the room: repo room → the repository's, then the org's (for
org members), then yours; org room → the org's, then yours; user room → yours. A repo room also
gives the agent the read tools at the default branch and, for writers on GitHub with a workspace
key, the workspace tools (see [Asking the agent](asking-the-agent.md)). One answer at a time per
session.

## Limits

Live events reach streams in the same process. With the worker in its own process
(`WORKER_INLINE=false`), stored messages still show but live progress from comment answers does
not.
