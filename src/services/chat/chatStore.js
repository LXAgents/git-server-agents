// Stored chat sessions and their messages (ChatSession / ChatMessage). A room holds many
// sessions, like conversations; each session keeps its messages and reports. Progress and
// streamed tokens are never stored. A session's kind is "chat" (the team chat) or "agent" (the
// Agent work pane); agent sessions also keep an AGENTS.md and a MEMORY.md.
const prisma = require('../../db');
const { HttpError } = require('../../errors');

const HISTORY_LIMIT = 200;
const MAX_CONTENT_CHARS = 20_000;
const MAX_TITLE_CHARS = 255;
const ACTIVITY_TITLE = 'Agent activity';
const KINDS = new Set(['chat', 'agent']);
// AGENTS.md and MEMORY.md of one agent session.
const MAX_FILE_CHARS = 20_000;
const FILES = { agentsMd: 'AGENTS.md', memoryMd: 'MEMORY.md' };

function isActivity(s) {
  return s.createdBy === null && s.title === ACTIVITY_TITLE;
}

// "agent" for the Agent activity session and agent sessions, else "chat".
function kindOf(s) {
  return isActivity(s) || s.kind === 'agent' ? 'agent' : 'chat';
}

function cleanKind(kind) {
  if (kind === undefined || kind === null || kind === '') return 'chat';
  if (!KINDS.has(kind)) throw new HttpError(400, 'kind must be "chat" or "agent"');
  return kind;
}

// A session as the API shows it. With `files`, an agent session also carries its AGENTS.md and
// MEMORY.md (lists leave them out, they can be long).
function sessionView(s, room, { files = false } = {}) {
  const view = { id: s.id, room, title: s.title, kind: kindOf(s), createdBy: s.createdBy, activity: isActivity(s), createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() };
  if (files && view.kind === 'agent') {
    view.agentsMd = s.agentsMd || '';
    view.memoryMd = s.memoryMd || '';
  }
  return view;
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

// The room's sessions, latest first; with `kind`, only that kind ("chat" or "agent").
async function listSessions(roomKey, room, { kind } = {}) {
  const rows = await prisma.chatSession.findMany({ where: { room: roomKey }, orderBy: { updatedAt: 'desc' }, take: 100 });
  const views = rows.map((s) => sessionView(s, room));
  return kind ? views.filter((v) => v.kind === kind) : views;
}

async function createSession(roomKey, room, { title, createdBy = null, kind } = {}) {
  const clean = cleanKind(kind);
  const fallback = clean === 'agent' ? 'New agent session' : 'New Chat';
  const row = await prisma.chatSession.create({ data: { room: roomKey, title: cleanTitle(title) || fallback, createdBy, kind: clean } });
  return sessionView(row, room, { files: true });
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

// Changes an agent session's AGENTS.md and/or MEMORY.md (`changes` has agentsMd and/or
// memoryMd; an empty text clears it). 400 for a team chat session or a text that is too long.
async function updateFiles(roomKey, room, id, changes) {
  const row = await requireSession(roomKey, id);
  if (kindOf(row) !== 'agent') throw new HttpError(400, 'only agent sessions have AGENTS.md and MEMORY.md');
  const data = {};
  for (const [field, name] of Object.entries(FILES)) {
    if (changes[field] === undefined) continue;
    if (typeof changes[field] !== 'string') throw new HttpError(400, `${name} must be text`);
    if (changes[field].length > MAX_FILE_CHARS) throw new HttpError(400, `${name} is longer than ${MAX_FILE_CHARS} characters`);
    data[field] = changes[field].trim() ? changes[field] : null;
  }
  if (Object.keys(data).length === 0) return sessionView(row, room, { files: true });
  return sessionView(await prisma.chatSession.update({ where: { id: row.id }, data }), room, { files: true });
}

async function deleteSession(roomKey, id) {
  await requireSession(roomKey, id);
  await prisma.chatSession.delete({ where: { id: String(id) } });
}

// The room's "Agent activity" session, where reports of comment-triggered answers go.
async function activitySession(roomKey) {
  const found = await prisma.chatSession.findFirst({ where: { room: roomKey, createdBy: null, title: ACTIVITY_TITLE } });
  return found || prisma.chatSession.create({ data: { room: roomKey, title: ACTIVITY_TITLE, createdBy: null, kind: 'agent' } });
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

module.exports = {
  listSessions,
  createSession,
  requireSession,
  renameSession,
  updateFiles,
  deleteSession,
  activitySession,
  isActivity,
  kindOf,
  sessionView,
  save,
  history,
  parseData,
  HISTORY_LIMIT,
  MAX_CONTENT_CHARS,
  MAX_FILE_CHARS,
  ACTIVITY_TITLE,
};
