// The chat API for signed-in users (see middleware/userAuth): rooms, sessions, messages and the
// live stream. Every request checks the room again on the platform with the caller's own token.
const rooms = require('../services/chat/rooms');
const store = require('../services/chat/chatStore');
const bus = require('../services/chat/bus');
const { emit } = require('../services/chat');
const { userSender } = require('../services/chat/events');
const chatAgent = require('../services/chat/chatAgent');
const { HttpError } = require('../errors');
const log = require('../services/logService');

const HEARTBEAT_MS = 25_000;
// An open stream checks the room again this often and closes once the caller lost access.
const RECHECK_MS = 5 * 60_000;

function owner(user) {
  return `${user.platform}:${user.id}`;
}

async function listRooms(req, res) {
  res.json(await rooms.listRooms(req.user));
}

async function listSessions(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  res.json(await store.listSessions(room.key, room.room));
}

async function createSession(req, res) {
  const body = req.body || {};
  const room = await rooms.authorizeRoom(req.user, body.room);
  res.status(201).json(await store.createSession(room.key, room.room, { title: body.title, createdBy: owner(req.user) }));
}

async function renameSession(req, res) {
  const body = req.body || {};
  const room = await rooms.authorizeRoom(req.user, body.room || req.query.room);
  res.json(await store.renameSession(room.key, room.room, req.params.id, body.title));
}

async function deleteSession(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  const session = await store.requireSession(room.key, req.params.id);
  // In shared rooms only the person who started a session may delete it.
  if (room.kind !== 'user' && session.createdBy !== owner(req.user)) throw new HttpError(403, 'only whoever started this session can delete it');
  await store.deleteSession(room.key, session.id);
  res.sendStatus(204);
}

async function listMessages(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  const session = await store.requireSession(room.key, req.query.sessionId);
  res.json(await store.history(session.id, room.room));
}

// POST { room, sessionId?, content }. Without a session one is started, titled from the message.
// Answers 201 with the stored message and whether the agent started answering.
async function postMessage(req, res) {
  const body = req.body || {};
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) throw new HttpError(400, 'content is required');
  if (content.length > store.MAX_CONTENT_CHARS) throw new HttpError(400, `content is longer than ${store.MAX_CONTENT_CHARS} characters`);
  const room = await rooms.authorizeRoom(req.user, body.room);
  const session = body.sessionId
    ? await store.requireSession(room.key, body.sessionId)
    : await store.createSession(room.key, room.room, { title: content.split('\n')[0].slice(0, 60), createdBy: owner(req.user) });
  const event = await emit({ key: room.key, room: room.room, sessionId: session.id }, { type: 'message', sender: userSender(req.user), content });
  if (!event) throw new Error('the message could not be stored');
  const { started, busy } = chatAgent.maybeAnswer({ room, user: req.user, sessionId: session.id, question: event });
  res.status(201).json({ message: event, sessionId: session.id, agent: started ? 'answering' : busy ? 'busy' : 'idle' });
}

// GET ?room=... Server-Sent Events for one room: every event of every session in it, as
// `data: <json>` lines. Read it with fetch, so the token stays in the Authorization header.
async function stream(req, res) {
  let room = await rooms.authorizeRoom(req.user, req.query.room);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const write = (text) => {
    if (!res.writableEnded) res.write(text);
  };
  write(`event: ready\ndata: ${JSON.stringify({ room: room.room })}\n\n`);
  const unsubscribe = bus.subscribe(room.key, (event) => write(`data: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);
  const recheck = setInterval(() => {
    rooms.authorizeRoom(req.user, req.query.room).then(
      (fresh) => {
        room = fresh;
      },
      (err) => {
        write(`event: error\ndata: ${JSON.stringify({ error: err.expose ? err.message : 'access check failed' })}\n\n`);
        res.end();
      }
    );
  }, RECHECK_MS);
  heartbeat.unref();
  recheck.unref();
  const close = () => {
    clearInterval(heartbeat);
    clearInterval(recheck);
    unsubscribe();
  };
  req.on('close', close);
  res.on('close', close);
  log.info('chat', `stream opened on a ${room.kind} room`, { platform: req.user.platform });
}

module.exports = { listRooms, listSessions, createSession, renameSession, deleteSession, listMessages, postMessage, stream };
