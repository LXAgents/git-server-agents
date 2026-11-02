# 1.19.0 — 2026-11-02

The chat API serves the dashboard's new single-room Chat page: a room summary for the details
pane, token counts on every answer, avatars, and an Agent activity session that always asks the
agent.

## Added

- `GET /api/chat/summary?room=`: room name and platform, the model and provider the agent would
  use, AI and workspace key counts (keys are counted, never read), and the total tokens and cost
  of the room's stored answers and reports. Anyone who may read the room may read it.
- Token counts: every answer counts input and output tokens from the provider's reply next to
  its cost. OpenAI and DeepSeek streams ask for usage with `stream_options.include_usage`.
- Answers and reports carry `data.usage`: `{ costUsd, costComplete, inputTokens, outputTokens,
  tokensComplete }`.
- `sender.avatarUrl` on chat events, from the poster's profile.

## Changed

- `ChatMessage` stores the event's `data` (JSON text, at most 4000 characters) and the sender's
  avatar, so history keeps model, cost, usage and avatars.
- Posting with `sessionId: "activity"` goes to the room's Agent activity session, where every
  message is for the agent in any room, without `@lxagents`. Sessions list it with
  `activity: true`, and it can no longer be renamed or deleted.

## Deploy

- Run `npm run db:push`: two nullable columns on `ChatMessage` (`senderAvatar`, `data`). Answers
  stored before 1.19.0 count as answers without usage.
- Deploy before dashboard 1.16.0.
