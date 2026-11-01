// What the rest of the server uses to talk to chat rooms: send an event live, and store the
// ones that are messages or reports in their session. Failures are logged, never thrown: the
// chat must not break an answer.
const bus = require('./bus');
const store = require('./chatStore');
const { makeEvent } = require('./events');
const log = require('../logService');

const STORED = new Set(['message', 'report']);

// Sends one event to a room. A target is { key, room, sessionId? }: `key` is the internal room
// key, `room` the public name. A stored event without a session goes to the room's
// "Agent activity" session.
async function emit(target, fields) {
  try {
    let sessionId = fields.sessionId || target.sessionId || null;
    if (STORED.has(fields.type) && !sessionId) sessionId = (await store.activitySession(target.key)).id;
    const event = makeEvent({ ...fields, room: target.room, sessionId });
    if (STORED.has(event.type)) event.id = await store.save(sessionId, event);
    bus.publish(target.key, event);
    return event;
  } catch (err) {
    log.warn('chat', `could not send a ${fields.type} event: ${err.message}`);
    return null;
  }
}

// A sender for several rooms at once, e.g. the commenter's user room and the repository's room.
function broadcaster(targets) {
  const list = targets.filter(Boolean);
  return {
    targets: list,
    send: (fields) => Promise.all(list.map((t) => emit(t, fields))),
    // Live only and synchronous: for progress and tokens.
    live: (fields) => {
      for (const t of list) {
        try {
          bus.publish(t.key, makeEvent({ ...fields, room: t.room, sessionId: fields.sessionId || t.sessionId || null }));
        } catch {
          // Best effort.
        }
      }
    },
  };
}

module.exports = { emit, broadcaster };
