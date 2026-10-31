// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.GITHUB_ADMIN_ID = '9999';
process.env.GITLAB_ADMIN_ID = '8';

const SOURCE = 'logtest';
let mock;
let prisma;
let server;
let base;
let log;

function call(path, { token = 'gh-stranger', platform = 'github' } = {}) {
  return fetch(`${base}/api/admin${path}`, { headers: { authorization: `Bearer ${token}`, 'x-platform': platform } });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  log = require('../src/services/logService');
  log.setStore(true);
  await prisma.log.deleteMany({ where: { source: { startsWith: SOURCE } } });
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  log.setStore(false);
  server.close();
  mock.close();
  await prisma.log.deleteMany({ where: { source: { startsWith: SOURCE } } });
  await prisma.account.deleteMany({ where: { OR: [{ type: 'github', id: { in: ['9999', '1001'] } }, { type: 'gitlab', id: '8' }] } });
  await prisma.$disconnect();
});

test('a log line is printed and stored, tagged with its platform and task', async () => {
  log.warn(SOURCE, 'GitHub refused', { platform: 'github', taskId: 't1' });
  log.info(SOURCE, 'server started');
  log.error(SOURCE, 'GitLab failed', { platform: 'gitlab' });
  await log.flush();
  const rows = await prisma.log.findMany({ where: { source: SOURCE }, orderBy: { message: 'asc' } });
  assert.deepEqual(rows.map((r) => [r.level, r.message, r.platform, r.taskId]), [
    ['warn', 'GitHub refused', 'github', 't1'],
    ['error', 'GitLab failed', 'gitlab', null],
    ['info', 'server started', null, null],
  ]);
});

test('the owner sees their platform\'s lines and the server\'s, newest first, filtered by level', async () => {
  const github = await (await call(`/logs?source=${SOURCE}`)).json();
  assert.deepEqual(github.logs.map((l) => l.message).sort(), ['GitHub refused', 'server started']);
  const gitlab = await (await call(`/logs?source=${SOURCE}`, { token: 'gl-dave', platform: 'gitlab' })).json();
  assert.deepEqual(gitlab.logs.map((l) => l.message).sort(), ['GitLab failed', 'server started']);
  const warnings = await (await call(`/logs?source=${SOURCE}&level=warn`)).json();
  assert.deepEqual(warnings.logs.map((l) => l.message), ['GitHub refused']);
});

test('pages with next and before', async () => {
  for (let i = 0; i < 3; i += 1) log.info(`${SOURCE}-page`, `line ${i}`);
  await log.flush();
  const first = await (await call(`/logs?source=${SOURCE}-page&limit=2`)).json();
  assert.equal(first.logs.length, 2);
  assert.ok(first.next);
  const second = await (await call(`/logs?source=${SOURCE}-page&limit=2&before=${first.next}`)).json();
  assert.equal(second.logs.length, 1);
  assert.equal(second.next, null);
  const all = [...first.logs, ...second.logs].map((l) => l.message).sort();
  assert.deepEqual(all, ['line 0', 'line 1', 'line 2']);
});

test('only the owner may read logs, and bad filters get 400', async () => {
  assert.equal((await call('/logs', { token: 'gh-alice' })).status, 403);
  assert.equal((await call('/logs?level=debug')).status, 400);
  assert.equal((await call('/logs?limit=0')).status, 400);
});

test('prune deletes lines older than the retention period', async () => {
  const old = await prisma.log.create({
    data: { level: 'info', source: `${SOURCE}-old`, message: 'old', createdAt: new Date(Date.now() - 20 * 86_400_000) },
  });
  assert.ok((await log.prune(Date.now(), 14)) >= 1);
  assert.equal(await prisma.log.count({ where: { id: old.id } }), 0);
});
