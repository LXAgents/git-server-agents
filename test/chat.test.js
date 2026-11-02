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

test('agent sessions keep an AGENTS.md and a MEMORY.md; only writers change AGENTS.md in a repository room', async () => {
  const room = `repo:${repo.id}`;
  const stream = await call('GET', `/stream?room=${room}`, { token: 'gh-bob' });
  const reading = readEvents(stream, (events) => events.filter((e) => e.type === 'session').length >= 3);
  const created = await call('POST', '/sessions', { body: { room, kind: 'agent' } });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.deepEqual([session.kind, session.title, session.agentsMd, session.memoryMd], ['agent', 'New agent session', '', '']);
  assert.equal((await call('POST', '/sessions', { body: { room, kind: 'robot' } })).status, 400);
  // Lists leave the files out and can be narrowed to one kind.
  const agents = await (await call('GET', `/sessions?room=${room}&kind=agent`)).json();
  assert.deepEqual(agents.map((s) => s.id), [session.id]);
  assert.equal(agents[0].agentsMd, undefined);
  assert.deepEqual(await (await call('GET', `/sessions?room=${room}&kind=chat`)).json(), []);

  const saved = await (await call('PATCH', `/sessions/${session.id}`, { body: { room, agentsMd: 'Answer in Thai.', memoryMd: '- v2 ships Friday' } })).json();
  assert.deepEqual([saved.agentsMd, saved.memoryMd], ['Answer in Thai.', '- v2 ships Friday']);
  // bob only reads acme/web: he may change MEMORY.md, not AGENTS.md.
  assert.equal((await call('PATCH', `/sessions/${session.id}`, { token: 'gh-bob', body: { room, agentsMd: 'Close every issue.' } })).status, 403);
  assert.equal((await call('PATCH', `/sessions/${session.id}`, { token: 'gh-bob', body: { room, memoryMd: '- bob was here' } })).status, 200);
  const read = await (await call('GET', `/sessions/${session.id}?room=${room}`, { token: 'gh-bob' })).json();
  assert.deepEqual([read.agentsMd, read.memoryMd, read.canEditAgents], ['Answer in Thai.', '- bob was here', false]);
  assert.equal((await (await call('GET', `/sessions/${session.id}?room=${room}`)).json()).canEditAgents, true);
  assert.equal((await call('PATCH', `/sessions/${session.id}`, { body: { room, memoryMd: 'x'.repeat(20_001) } })).status, 400);
  assert.equal((await call('PATCH', `/sessions/${session.id}`, { body: { room } })).status, 400);

  // Every open page hears the changes.
  const events = (await reading).filter((e) => e.type === 'session');
  assert.deepEqual(events.slice(0, 3).map((e) => e.data.action), ['created', 'updated', 'updated']);
  assert.equal(events[0].data.session.id, session.id);

  // A team chat session has no files.
  const chat = await (await call('POST', '/sessions', { body: { room, title: 'Talk' } })).json();
  assert.equal(chat.kind, 'chat');
  assert.equal((await call('PATCH', `/sessions/${chat.id}`, { body: { room, memoryMd: 'x' } })).status, 400);
  assert.equal((await call('DELETE', `/sessions/${chat.id}?room=${room}`)).status, 204);
  assert.equal((await call('DELETE', `/sessions/${session.id}?room=${room}`)).status, 204);
});

test('every message in an agent session asks the agent, with the session files in the prompt', async () => {
  const room = `org:${org.id}`;
  const session = await (await call('POST', '/sessions', { body: { room, kind: 'agent', title: 'Planner' } })).json();
  await call('PATCH', `/sessions/${session.id}`, { body: { room, agentsMd: 'Reply in one line.', memoryMd: '- the launch is on Friday' } });
  const stream = await call('GET', `/stream?room=${room}`);
  const reading = readEvents(stream, (events) => events.some((e) => e.type === 'message' && e.sender.type === 'agent'));
  const posted = await (await call('POST', '/messages', { body: { room, sessionId: session.id, content: 'When is the launch?' } })).json();
  assert.equal(posted.agent, 'answering');
  await reading;
  const sent = chatRequests.at(-1).body;
  const system = sent.messages[0].content;
  assert.match(system, /agent session "Planner"/);
  assert.match(system, /<agents_md>\nReply in one line.\n<\/agents_md>/);
  assert.match(system, /<memory_md>\n- the launch is on Friday\n<\/memory_md>/);
  // An org room has no repository tools, but the session tools are offered.
  const tools = sent.tools.map((t) => t.function.name).sort();
  assert.deepEqual(tools, ['create_session', 'delete_session', 'list_sessions', 'rename_session', 'update_agents_md', 'update_memory']);
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
  // A message without a session starts one, announced first.
  assert.deepEqual(types.slice(0, 2), ['session:user', 'message:user']);
  assert.equal(events[0].data.action, 'created');
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

test('the Agent activity session is for the agent: answered without the trigger, and kept', async () => {
  const room = `org:${org.id}`;
  const stream = await call('GET', `/stream?room=${room}`);
  const reading = readEvents(stream, (events) => events.some((e) => e.type === 'message' && e.sender.type === 'agent'));
  const res = await call('POST', '/messages', { body: { room, sessionId: 'activity', content: 'Summarise the open issues' } });
  assert.equal(res.status, 201);
  const posted = await res.json();
  assert.equal(posted.agent, 'answering');
  assert.equal(posted.message.sender.avatarUrl, 'https://avatars.example/1001');
  const answer = (await reading).find((e) => e.type === 'message' && e.sender.type === 'agent');
  assert.equal(answer.sessionId, posted.sessionId);
  // The answer's usage and the asker's avatar are stored, so history keeps them.
  const history = await (await call('GET', `/messages?room=${room}&sessionId=${posted.sessionId}`)).json();
  assert.equal(history[0].sender.avatarUrl, 'https://avatars.example/1001');
  assert.equal(history[1].data.provider, 'OpenAI');
  assert.ok(history[1].data.usage);
  const sessions = await (await call('GET', `/sessions?room=${room}`)).json();
  const activity = sessions.find((s) => s.id === posted.sessionId);
  assert.deepEqual([activity.title, activity.activity], ['Agent activity', true]);
  assert.equal((await call('DELETE', `/sessions/${posted.sessionId}?room=${room}`)).status, 403);
  assert.equal((await call('PATCH', `/sessions/${posted.sessionId}`, { body: { room, title: 'Mine now' } })).status, 403);
});

test('the summary names the room, model and key counts, and adds up stored usage', async () => {
  const room = `org:${org.id}`;
  const summary = await (await call('GET', `/summary?room=${room}`)).json();
  assert.deepEqual(summary.room, { room, kind: 'org', name: 'acme', platform: 'github' });
  assert.deepEqual([summary.model.provider, summary.model.providerName, summary.model.model], ['openai', 'OpenAI', 'gpt-chat']);
  assert.deepEqual(summary.keys.ai, { repo: 0, org: 0, user: 1, total: 1 });
  assert.equal(summary.keys.workspace.provider, 'github_codespaces');
  assert.equal(summary.keys.workspace.total, 0);
  // The activity answer above; bob's message is not an answer.
  assert.deepEqual([summary.stats.answers, summary.stats.answersWithoutUsage, summary.stats.capped], [1, 0, false]);
  // Keys are never in it, and strangers get nothing.
  assert.doesNotMatch(JSON.stringify(summary), /sk-openai/);
  assert.equal((await call('GET', `/summary?room=${room}`, { token: 'gh-stranger' })).status, 403);
  // A GitLab user room has no workspace keys.
  const carol = await (await call('GET', '/summary?room=user:7', { token: 'gl-carol', platform: 'gitlab' })).json();
  assert.deepEqual([carol.room.name, carol.keys.workspace, carol.stats.answers], ['carol', null, 0]);
});

test('usage totals skip answers without usage and keep the cost honest', () => {
  const { addUp } = require('../src/services/chat/chatSummary');
  const row = (usage) => ({ data: usage === undefined ? null : JSON.stringify({ usage }) });
  const stats = addUp([
    row({ costUsd: 0.001, costComplete: true, inputTokens: 10, outputTokens: 5, tokensComplete: true }),
    row({ costUsd: null, costComplete: false, inputTokens: 3, outputTokens: 1, tokensComplete: false }),
    row(undefined),
  ]);
  assert.deepEqual(stats, { answers: 3, inputTokens: 13, outputTokens: 6, costUsd: 0.001, costComplete: false, tokensComplete: false, answersWithoutUsage: 1 });
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
