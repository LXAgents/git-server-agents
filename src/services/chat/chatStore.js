// Stored chat sessions and their messages (ChatSession / ChatMessage). A room holds many
// sessions, like conversations; each session keeps its messages and reports. Progress and
// streamed tokens are never stored.
const prisma = require('../../db');
const { HttpError } = require('../../errors');

const HISTORY_LIMIT = 200;
const MAX_CONTENT_CHARS = 20_000;
const MAX_TITLE_CHARS = 255;
const ACTIVITY_TITLE = 'Agent activity';

function isActivity(s) {
  return s.createdBy === null && s.title === ACTIVITY_TITLE;
}

function sessionView(s, room) {
  return { id: s.id, room, title: s.title, createdBy: s.createdBy, activity: isActivity(s), createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
}

// Stored event data is capped, so one odd event can't bloat the table.
const MAX_DATA_CHARS = 4000;

function dataText(data) {
  if (data === undefined || data === null) return null;
  const text = JSON.stringify(data);
  return text.length <= MAX_DATA_CHARS ? text : null;
}

function parseData(text) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
      senderAvatar: event.sender.avatarUrl || null,
      content: String(event.content).slice(0, MAX_CONTENT_CHARS),
      data: dataText(event.data),
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
  return rows.reverse().map((r) => {
    const sender = { id: r.senderId, login: r.senderLogin, type: r.role === 'assistant' ? 'agent' : 'user' };
    if (r.senderAvatar) sender.avatarUrl = r.senderAvatar;
    const event = { id: r.id, type: r.type, room, sessionId, sender, content: r.content, timestamp: r.createdAt.toISOString() };
    const data = parseData(r.data);
    if (data !== undefined) event.data = data;
    return event;
  });
}

module.exports = { listSessions, createSession, requireSession, renameSession, deleteSession, activitySession, isActivity, save, history, parseData, HISTORY_LIMIT, MAX_CONTENT_CHARS, ACTIVITY_TITLE };
