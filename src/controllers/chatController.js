// The chat API for signed-in users (see middleware/userAuth): rooms, sessions, messages and the
// live stream. Every request checks the room again on the platform with the caller's own token.
const rooms = require('../services/chat/rooms');
const store = require('../services/chat/chatStore');
const sessions = require('../services/chat/sessions');
const bus = require('../services/chat/bus');
const { emit } = require('../services/chat');
const { userSender } = require('../services/chat/events');
const chatAgent = require('../services/chat/chatAgent');
const chatSummary = require('../services/chat/chatSummary');
const { HttpError } = require('../errors');
const log = require('../services/logService');
const { logSafe } = require('../utils/strings');

const HEARTBEAT_MS = 25_000;
// An open stream checks the room again this often and closes once the caller lost access.
const RECHECK_MS = 5 * 60_000;

async function listRooms(req, res) {
  res.json(await rooms.listRooms(req.user));
}

// GET ?room=... The details pane: room, model and provider, key counts and usage totals.
async function summary(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  res.json(await chatSummary.summary(room, req.user));
}

// GET ?room=...&kind=chat|agent
async function listSessions(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  const kind = req.query.kind === 'chat' || req.query.kind === 'agent' ? req.query.kind : undefined;
  res.json(await store.listSessions(room.key, room.room, { kind }));
}

// GET /sessions/:id?room=... One session; an agent session with its AGENTS.md and MEMORY.md, and
// whether the caller may change AGENTS.md.
async function getSession(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  const row = await store.requireSession(room.key, req.params.id);
  res.json({ ...store.sessionView(row, room.room, { files: true }), canEditAgents: sessions.mayEditAgents(room) });
}

// POST { room, title?, kind? }: kind "chat" (default) or "agent".
async function createSession(req, res) {
  const body = req.body || {};
  const room = await rooms.authorizeRoom(req.user, body.room);
  res.status(201).json(await sessions.create(room, req.user, userSender(req.user), { title: body.title, kind: body.kind }));
}

// PATCH { room, title?, agentsMd?, memoryMd? }: renames the session and/or changes its files.
async function updateSession(req, res) {
  const body = req.body || {};
  const room = await rooms.authorizeRoom(req.user, body.room || req.query.room);
  const sender = userSender(req.user);
  const files = body.agentsMd !== undefined || body.memoryMd !== undefined;
  if (body.title === undefined && !files) throw new HttpError(400, 'title, agentsMd or memoryMd is required');
  let session = null;
  if (body.title !== undefined) session = await sessions.rename(room, sender, req.params.id, body.title);
  if (files) session = await sessions.updateFiles(room, sender, req.params.id, { agentsMd: body.agentsMd, memoryMd: body.memoryMd });
  res.json(session);
}

async function deleteSession(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  await sessions.remove(room, req.user, userSender(req.user), req.params.id);
  res.sendStatus(204);
}

async function listMessages(req, res) {
  const room = await rooms.authorizeRoom(req.user, req.query.room);
  const session = await store.requireSession(room.key, req.query.sessionId);
  res.json(await store.history(session.id, room.room));
}

// POST { room, sessionId?, content }. Without a session a team chat session is started, titled
// from the message. sessionId "activity" posts to the room's Agent activity session. In agent
// sessions (the activity one included) every message is for the agent. Answers 201 with the
// stored message and whether the agent started answering, queued it, or was not asked.
async function sessionFor(room, sessionId, content, user) {
  if (sessionId === 'activity') return store.activitySession(room.key);
  if (sessionId) return store.requireSession(room.key, sessionId);
  return sessions.create(room, user, userSender(user), { title: content.split('\n')[0].slice(0, 60) });
}

async function postMessage(req, res) {
  const body = req.body || {};
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) throw new HttpError(400, 'content is required');
  if (content.length > store.MAX_CONTENT_CHARS) throw new HttpError(400, `content is longer than ${store.MAX_CONTENT_CHARS} characters`);
  const room = await rooms.authorizeRoom(req.user, body.room);
  const session = await sessionFor(room, body.sessionId, content, req.user);
  const event = await emit({ key: room.key, room: room.room, sessionId: session.id }, { type: 'message', sender: userSender(req.user), content });
  if (!event) throw new Error('the message could not be stored');
  const { agent } = chatAgent.maybeAnswer({ room, user: req.user, sessionId: session.id, question: event, activity: store.kindOf(session) === 'agent' });
  res.status(201).json({ message: event, sessionId: session.id, agent });
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
  log.info('chat', `stream opened on a ${logSafe(room.kind)} room`, { platform: req.user.platform });
}

module.exports = { listRooms, summary, listSessions, getSession, createSession, updateSession, deleteSession, listMessages, postMessage, stream };
