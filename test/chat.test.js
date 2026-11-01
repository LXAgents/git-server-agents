// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform, chatRequests } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

let mock;
let server;
let base;
let prisma;
let org;
let repo;
let savedUrl;
let openaiId;
const ACCOUNTS = [
  ['github', '1001'],
  ['github', '1002'],
  ['github', '9999'],
  ['gitlab', '7'],
];

function call(method, path, { token = 'gh-alice', platform = 'github', body } = {}) {
  return fetch(`${base}/api/chat${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-platform': platform, authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Reads SSE `data:` events from the stream until `until(events)` is true.
async function readEvents(res, until, timeoutMs = 5000) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const stop = Date.now() + timeoutMs;
  while (!until(events)) {
    if (Date.now() > stop) throw new Error(`timed out with ${JSON.stringify(events.map((e) => e.type))}`);
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (data && !block.startsWith('event: ready')) events.push(JSON.parse(data.slice(6)));
    }
  }
  await reader.cancel();
  return events;
}

async function cleanup() {
  await prisma.chatSession.deleteMany({});
  await prisma.appInstallation.deleteMany({ where: { platform: 'github', orgName: 'acme' } });
  for (const [type, id] of ACCOUNTS) await prisma.account.deleteMany({ where: { type, id } });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  const { encrypt } = require('../src/services/cryptoService');
  await cleanup();
  await prisma.account.create({ data: { type: 'github', id: '1001' } });
  org = await prisma.appInstallation.create({ data: { platform: 'github', orgName: 'acme', installationId: '555', accountType: 'github', accountId: '1001' } });
  repo = await prisma.repository.create({ data: { platform: 'github', externalId: '301', fullName: 'acme/web', appInstallationId: org.id } });
  const openai = await prisma.provider.findFirst({ where: { slug: 'openai' } });
  assert.ok(openai, 'run npm run db:seed first');
  // Point the stored OpenAI URL at the mock for this suite, and put it back afterwards.
  savedUrl = openai.url;
  openaiId = openai.id;
  await prisma.provider.update({ where: { id: openai.id }, data: { url: process.env.OPENAI_API_URL } });
  await prisma.accountKey.create({ data: { accountType: 'github', accountId: '1001', providerId: openai.id, apiKeyEncrypted: encrypt('sk-openai-good') } });
  await prisma.modelSetting.create({ data: { accountType: 'github', accountId: '1001', modality: 'text', provider: 'openai', model: 'gpt-chat' } });
  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await prisma.provider.update({ where: { id: openaiId }, data: { url: savedUrl } });
  await cleanup();
  await prisma.$disconnect();
});

test('lists the rooms the caller may join, checked on the platform', async () => {
  const alice = await (await call('GET', '/rooms')).json();
  assert.deepEqual(alice, {
    user: { room: 'user:1001', name: 'alice' },
    orgs: [{ room: `org:${org.id}`, name: 'acme' }],
    repos: [{ room: `repo:${repo.id}`, name: 'acme/web' }],
  });
  const stranger = await (await call('GET', '/rooms', { token: 'gh-stranger' })).json();
  assert.deepEqual([stranger.orgs, stranger.repos], [[], []]);
});

test('refuses rooms that are not the caller\'s', async () => {
  assert.equal((await call('GET', '/sessions?room=user:1001', { token: 'gh-bob' })).status, 403);
  assert.equal((await call('GET', `/sessions?room=org:${org.id}`, { token: 'gh-stranger' })).status, 403);
  assert.equal((await call('GET', `/sessions?room=repo:${repo.id}`, { token: 'gh-stranger' })).status, 403);
  assert.equal((await call('GET', '/sessions?room=repo:missing')).status, 404);
  assert.equal((await call('GET', '/sessions?room=nonsense')).status, 400);
  // A collaborator (bob only reads acme/web) and an org member may join.
  assert.equal((await call('GET', `/sessions?room=repo:${repo.id}`, { token: 'gh-bob' })).status, 200);
  assert.equal((await call('GET', `/sessions?room=org:${org.id}`, { token: 'gh-bob' })).status, 200);
  // A GitLab user cannot reach a GitHub repository room.
  assert.equal((await call('GET', `/sessions?room=repo:${repo.id}`, { token: 'gl-carol', platform: 'gitlab' })).status, 404);
});

test('sessions: create, rename, list and delete; only the starter deletes in shared rooms', async () => {
  const room = `repo:${repo.id}`;
  const created = await call('POST', '/sessions', { body: { room, title: 'Release talk' } });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(session.title, 'Release talk');
  const renamed = await (await call('PATCH', `/sessions/${session.id}`, { body: { room, title: 'Release 2' } })).json();
  assert.equal(renamed.title, 'Release 2');
  assert.deepEqual((await (await call('GET', `/sessions?room=${room}`, { token: 'gh-bob' })).json()).map((s) => s.id), [session.id]);
  assert.equal((await call('DELETE', `/sessions/${session.id}?room=${room}`, { token: 'gh-bob' })).status, 403);
  // A session id never opens another room.
  assert.equal((await call('GET', `/messages?room=org:${org.id}&sessionId=${session.id}`)).status, 404);
  assert.equal((await call('DELETE', `/sessions/${session.id}?room=${room}`)).status, 204);
});

test('messages in shared rooms without the trigger are stored and not answered', async () => {
  const room = `org:${org.id}`;
  const res = await call('POST', '/messages', { token: 'gh-bob', body: { room, content: 'Standup in five minutes' } });
  assert.equal(res.status, 201);
  const posted = await res.json();
  assert.equal(posted.agent, 'idle');
  assert.deepEqual([posted.message.type, posted.message.sender.login, posted.message.sender.type], ['message', 'bob', 'user']);
  const history = await (await call('GET', `/messages?room=${room}&sessionId=${posted.sessionId}`)).json();
  assert.deepEqual(history.map((m) => m.content), ['Standup in five minutes']);
  const session = (await (await call('GET', `/sessions?room=${room}`)).json()).find((s) => s.id === posted.sessionId);
  assert.equal(session.title, 'Standup in five minutes');
  assert.equal((await call('POST', '/messages', { body: { room, content: '   ' } })).status, 400);
});

test('the stream carries the room\'s events and the agent answers in the personal room', async () => {
  const stream = await call('GET', '/stream?room=user:1001');
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reading = readEvents(stream, (events) => events.some((e) => e.type === 'message' && e.sender.type === 'agent'));
  const posted = await (await call('POST', '/messages', { body: { room: 'user:1001', content: 'What is 2 + 2?' } })).json();
  assert.equal(posted.agent, 'answering');
  const events = await reading;
  const types = events.map((e) => `${e.type}:${e.sender.type}`);
  assert.equal(types[0], 'message:user');
  assert.ok(types.includes('progress:agent'));
  // The answer streams in pieces before the stored message arrives.
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.content);
  assert.ok(tokens.length > 1);
  assert.equal(tokens.join(''), 'openai says hi to gpt-chat');
  assert.equal(chatRequests.at(-1).body.stream, true);
  const answer = events.find((e) => e.type === 'message' && e.sender.type === 'agent');
  assert.equal(answer.content, 'openai says hi to gpt-chat');
  assert.equal(answer.sessionId, posted.sessionId);
  assert.equal(answer.room, 'user:1001');
  assert.equal(answer.data.provider, 'OpenAI');
  const sent = chatRequests.at(-1).body.messages;
  assert.equal(sent.at(-1).content, '@alice: What is 2 + 2?');
  // Both are stored in the session, as user and assistant.
  const history = await (await call('GET', `/messages?room=user:1001&sessionId=${posted.sessionId}`)).json();
  assert.deepEqual(history.map((m) => m.sender.type), ['user', 'agent']);
  const rows = await prisma.chatMessage.findMany({ where: { sessionId: posted.sessionId }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((r) => r.role), ['user', 'assistant']);
});

test('without a key the agent answers with the error code', async () => {
  const stream = await call('GET', '/stream?room=user:1002', { token: 'gh-bob' });
  const reading = readEvents(stream, (events) => events.some((e) => e.sender.type === 'agent' && e.type === 'message'));
  await call('POST', '/messages', { token: 'gh-bob', body: { room: 'user:1002', content: 'hello' } });
  const answer = (await reading).find((e) => e.sender.type === 'agent' && e.type === 'message');
  assert.match(answer.content, /NO_API_KEY/);
  assert.equal(answer.data.error, true);
});

test('user room keys name the platform, so equal ids on GitHub and GitLab never share a room', () => {
  const { userRoomKey } = require('../src/services/chat/rooms');
  assert.notEqual(userRoomKey('github', '7'), userRoomKey('gitlab', '7'));
});

test('a comment answer shows progress, tokens only when watched, and a stored report', async () => {
  const bus = require('../src/services/chat/bus');
  const { chatFor } = require('../src/services/agent/chatProgress');
  const args = {
    task: { id: 'task-1', platform: 'github' },
    comment: { kind: 'issue', number: 12 },
    identity: { triggerUserId: '1001' },
    repository: repo,
    asker: 'alice',
    where: 'acme/web#12',
  };
  // Nobody watching: no token hook, so the provider is asked exactly as before.
  assert.equal(chatFor(args).hooks().onToken, undefined);

  const seen = [];
  const off = bus.subscribe(`repo:${repo.id}`, (e) => seen.push(e));
  const chat = chatFor(args);
  const hooks = chat.hooks();
  hooks.onRound();
  hooks.onToken('Hel');
  hooks.onTool({ tool: 'create_workspace', status: 'Creating GitHub Codespace...' });
  await chat.report('Done: tests pass.', { model: 'm' });
  off();
  assert.deepEqual(
    seen.map((e) => e.type),
    ['progress', 'progress', 'token', 'progress', 'report']
  );
  assert.equal(seen[0].content, 'Answering @alice on acme/web#12');
  assert.deepEqual(seen[3].data.tool, 'create_workspace');
  assert.equal(seen[4].room, `repo:${repo.id}`);
  // Reports go to each room's "Agent activity" session.
  const sessions = await (await call('GET', `/sessions?room=repo:${repo.id}`)).json();
  const activity = sessions.find((s) => s.title === 'Agent activity');
  const history = await (await call('GET', `/messages?room=repo:${repo.id}&sessionId=${activity.id}`)).json();
  assert.deepEqual(history.map((m) => [m.type, m.content]), [['report', 'Done: tests pass.']]);
  assert.equal(seen[4].sessionId, activity.id);
});
