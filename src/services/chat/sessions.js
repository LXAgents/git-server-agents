// Creating, renaming, changing and deleting chat sessions, with the same rules for the API and
// for the agent's session tools. Every change is announced live to the room as a "session" event,
// so every open page refreshes its lists.
//   - The Agent activity session cannot be renamed or deleted (its AGENTS.md and MEMORY.md can be
//     changed).
//   - In shared rooms (repository, organization) only whoever started a session may delete it.
//   - In a repository room only people with write access may change AGENTS.md: it is instructions
//     to the agent, which may hold a writer's tools.
const store = require('./chatStore');
const bus = require('./bus');
const { makeEvent } = require('./events');
const { HttpError } = require('../../errors');

function ownerOf(user) {
  return `${user.platform}:${user.id}`;
}

const isWriter = (room) => room.level === 'admin' || room.level === 'write';

// Whether `user` may change the AGENTS.md of sessions in `room`.
function mayEditAgents(room) {
  return room.kind !== 'repo' || isWriter(room);
}

function announce(room, sender, action, session) {
  try {
    const view = { id: session.id, room: room.room, title: session.title, kind: session.kind, activity: Boolean(session.activity), createdBy: session.createdBy };
    bus.publish(room.key, makeEvent({ type: 'session', room: room.room, sessionId: session.id, sender, content: action, data: { action, session: view } }));
  } catch {
    // Live only: a page that missed it still sees the change on its next load.
  }
}

async function create(room, user, sender, { title, kind } = {}) {
  const session = await store.createSession(room.key, room.room, { title, kind, createdBy: ownerOf(user) });
  announce(room, sender, 'created', session);
  return session;
}

async function rename(room, sender, id, title) {
  if (store.isActivity(await store.requireSession(room.key, id))) throw new HttpError(403, 'the Agent activity session cannot be renamed');
  const session = await store.renameSession(room.key, room.room, id, title);
  announce(room, sender, 'renamed', session);
  return session;
}

async function updateFiles(room, sender, id, { agentsMd, memoryMd } = {}) {
  if (agentsMd !== undefined && !mayEditAgents(room)) throw new HttpError(403, `only people with write access to ${room.name || 'this repository'} can change AGENTS.md`);
  const session = await store.updateFiles(room.key, room.room, id, { agentsMd, memoryMd });
  announce(room, sender, 'updated', session);
  return session;
}

// Deletes session `id`. `keep` is a session id that must not be deleted (the one being answered).
async function remove(room, user, sender, id, { keep = null } = {}) {
  const row = await store.requireSession(room.key, id);
  if (store.isActivity(row)) throw new HttpError(403, 'the Agent activity session cannot be deleted');
  if (keep && row.id === keep) throw new HttpError(400, 'this session is being answered and cannot be deleted now');
  if (room.kind !== 'user' && row.createdBy !== ownerOf(user)) throw new HttpError(403, 'only whoever started this session can delete it');
  await store.deleteSession(room.key, row.id);
  announce(room, sender, 'deleted', store.sessionView(row, room.room));
}

module.exports = { create, rename, updateFiles, remove, mayEditAgents, ownerOf, isWriter };
