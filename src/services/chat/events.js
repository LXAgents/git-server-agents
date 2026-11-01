// The chat's one event shape:
//   { type: 'message' | 'progress' | 'report' | 'token', room, sessionId, sender: { id, login, type },
//     content, data?, timestamp }
// sender.type is "user" or "agent". `room` is the room as the client named it ("user:1001",
// "repo:<id>", "org:<id>"). "token" carries a piece of the agent's answer while it is written.
const AGENT = Object.freeze({ id: 'lxagents', login: 'LXAgents', type: 'agent' });
const TYPES = new Set(['message', 'progress', 'report', 'token']);

function makeEvent({ type, room, sessionId = null, sender, content = '', data, timestamp = new Date() }) {
  if (!TYPES.has(type)) throw new Error(`unknown chat event type ${type}`);
  const event = {
    type,
    room,
    sessionId,
    sender: { id: String(sender.id), login: sender.login || null, type: sender.type },
    content: String(content),
    timestamp: new Date(timestamp).toISOString(),
  };
  if (data !== undefined) event.data = data;
  return event;
}

function userSender(user) {
  return { id: String(user.id), login: user.login || null, type: 'user' };
}

module.exports = { AGENT, TYPES, makeEvent, userSender };
