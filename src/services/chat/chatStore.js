// Stored chat sessions and their messages (ChatSession / ChatMessage). A room holds many
// sessions, like conversations; each session keeps its messages and reports. Progress and
// streamed tokens are never stored.
const prisma = require('../../db');
const { HttpError } = require('../../errors');

const HISTORY_LIMIT = 200;
const MAX_CONTENT_CHARS = 20_000;
const MAX_TITLE_CHARS = 255;
const ACTIVITY_TITLE = 'Agent activity';

function sessionView(s, room) {
  return { id: s.id, room, title: s.title, createdBy: s.createdBy, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
}

function cleanTitle(title) {
  const text = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_TITLE_CHARS) : null;
}

async function listSessions(roomKey, room) {
  const rows = await prisma.chatSession.findMany({ where: { room: roomKey }, orderBy: { updatedAt: 'desc' }, take: 100 });
  return rows.map((s) => sessionView(s, room));
}

async function createSession(roomKey, room, { title, createdBy = null } = {}) {
  const row = await prisma.chatSession.create({ data: { room: roomKey, title: cleanTitle(title) || 'New Chat', createdBy } });
  return sessionView(row, room);
}

// The session `id` if it belongs to the room, or 404: a session id never opens another room.
async function requireSession(roomKey, id) {
  const row = id ? await prisma.chatSession.findUnique({ where: { id: String(id) } }) : null;
  if (!row || row.room !== roomKey) throw new HttpError(404, 'chat session not found');
  return row;
}

async function renameSession(roomKey, room, id, title) {
  await requireSession(roomKey, id);
  const clean = cleanTitle(title);
  if (!clean) throw new HttpError(400, 'title is required');
  return sessionView(await prisma.chatSession.update({ where: { id: String(id) }, data: { title: clean } }), room);
}

async function deleteSession(roomKey, id) {
  await requireSession(roomKey, id);
  await prisma.chatSession.delete({ where: { id: String(id) } });
}

// The room's "Agent activity" session, where reports of comment-triggered answers go.
async function activitySession(roomKey) {
  const found = await prisma.chatSession.findFirst({ where: { room: roomKey, createdBy: null, title: ACTIVITY_TITLE } });
  return found || prisma.chatSession.create({ data: { room: roomKey, title: ACTIVITY_TITLE, createdBy: null } });
}

async function save(sessionId, event) {
  const row = await prisma.chatMessage.create({
    data: {
      sessionId,
      role: event.sender.type === 'agent' ? 'assistant' : 'user',
      type: event.type,
      senderId: event.sender.id,
      senderLogin: event.sender.login,
      content: String(event.content).slice(0, MAX_CONTENT_CHARS),
      createdAt: new Date(event.timestamp),
    },
  });
  // Bumps updatedAt, so the session list shows the latest conversation first.
  await prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
  return row.id;
}

// The session's last `limit` stored events, oldest first, in the event shape.
async function history(sessionId, room, limit = HISTORY_LIMIT) {
  const rows = await prisma.chatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, HISTORY_LIMIT) });
  return rows.reverse().map((r) => ({
    id: r.id,
    type: r.type,
    room,
    sessionId,
    sender: { id: r.senderId, login: r.senderLogin, type: r.role === 'assistant' ? 'agent' : 'user' },
    content: r.content,
    timestamp: r.createdAt.toISOString(),
  }));
}

module.exports = { listSessions, createSession, requireSession, renameSession, deleteSession, activitySession, save, history, HISTORY_LIMIT, MAX_CONTENT_CHARS, ACTIVITY_TITLE };
