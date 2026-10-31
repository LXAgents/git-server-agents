# 1.11.1 — 2026-10-31

## Added

- **User line.** Every answer's footer gets a third line, `User: @username`, naming the
  commenter who asked. It sits under the Model and Cost lines, and the username is in a code
  span, so nobody is notified.

## Changed

- **Reply marker.** The hidden marker is now `<!-- LXAgents -->`, and error replies also carry
  `<!-- LXAgents:error -->`. Replies with the old `<!-- git-server-agents -->` marker are still
  recognised, so the agent never answers them.
