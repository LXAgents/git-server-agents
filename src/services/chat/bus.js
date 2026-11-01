// The live side of the chat: an in-process publish/subscribe bus keyed by room. Each SSE
// connection subscribes to one room. Nothing here is stored (see chatStore for that), and it
// only reaches connections in this process, so live progress needs the inline worker
// (WORKER_INLINE, the default).
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
// One listener per open connection; there is no fixed limit to warn about.
emitter.setMaxListeners(0);

function subscribe(roomKey, listener) {
  emitter.on(roomKey, listener);
  return () => emitter.off(roomKey, listener);
}

// Sends `event` to every connection on the room. A failing listener never stops the others.
function publish(roomKey, event) {
  for (const listener of emitter.listeners(roomKey)) {
    try {
      listener(event);
    } catch {
      // A broken connection is cleaned up by its own close handler.
    }
  }
}

function listenerCount(roomKey) {
  return emitter.listenerCount(roomKey);
}

module.exports = { subscribe, publish, listenerCount };
