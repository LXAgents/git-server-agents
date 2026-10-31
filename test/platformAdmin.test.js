// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.ADMIN_TOKEN = 'admin-test-token';
// stranger (GitHub 9999) is not whitelisted; dave (GitLab 8) is a GitLab admin; alice is neither.
process.env.GITHUB_ADMIN_ID = ' 9999 , 123';
process.env.GITLAB_ADMIN_ID = '8';

let mock;
let server;
let base;
let prisma;

function call(path, { token, platform } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (platform) headers['x-platform'] = platform;
  return fetch(`${base}${path}`, { headers });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { type: 'github', id: '9999' } });
  await prisma.account.deleteMany({ where: { type: 'gitlab', id: '8' } });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  const { createApp } = require('../src/app');
  await cleanup();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await cleanup();
  await prisma.$disconnect();
});

test('a user whose platform ID is an admin ID opens the admin API with their own token', async () => {
  assert.equal((await call('/api/admin/accounts', { token: 'gh-stranger', platform: 'github' })).status, 200);
  assert.equal((await call('/api/admin/orgs', { token: 'gl-dave', platform: 'gitlab' })).status, 200);
});

test('any other platform user gets 403, and a bad token 401', async () => {
  assert.equal((await call('/api/admin/accounts', { token: 'gh-alice', platform: 'github' })).status, 403);
  assert.equal((await call('/api/admin/accounts', { token: 'gl-carol', platform: 'gitlab' })).status, 403);
  assert.equal((await call('/api/admin/accounts', { token: 'bogus', platform: 'github' })).status, 401);
  // An ID from the other platform's list grants nothing.
  assert.equal((await call('/api/admin/accounts', { token: 'gh-alice', platform: 'gitlab' })).status, 401);
});

test('ADMIN_TOKEN still opens the admin API, for the platform it names', async () => {
  assert.equal((await call('/api/admin/accounts', { token: 'admin-test-token', platform: 'gitlab' })).status, 200);
  assert.equal((await call('/api/admin/accounts', { token: 'admin-test-token' })).status, 400);
});

test('a configured admin ID becomes an owner on first sign-in, and nothing about them is stored but the role', async () => {
  const res = await call('/api/user/me', { token: 'gh-stranger', platform: 'github' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { platform: 'github', id: '9999', login: 'stranger', name: null, avatarUrl: null, role: 'owner' });
  const account = await prisma.account.findUnique({ where: { type_id: { type: 'github', id: '9999' } } });
  assert.equal(account.role, 'owner');
  assert.equal('username' in account, false);
});

test('an owner role in the database opens the admin API without an admin ID', async () => {
  // alice (GitHub 1001) is not in GITHUB_ADMIN_ID.
  await prisma.account.upsert({
    where: { type_id: { type: 'github', id: '1001' } },
    create: { type: 'github', id: '1001', role: 'owner' },
    update: { role: 'owner' },
  });
  try {
    assert.equal((await call('/api/admin/accounts', { token: 'gh-alice', platform: 'github' })).status, 200);
  } finally {
    await prisma.account.deleteMany({ where: { type: 'github', id: '1001' } });
  }
});

test('a configured admin ID that was demoted in the database is made owner again', async () => {
  await prisma.account.update({ where: { type_id: { type: 'github', id: '9999' } }, data: { role: 'member' } });
  assert.equal((await call('/api/admin/accounts', { token: 'gh-stranger', platform: 'github' })).status, 200);
  const account = await prisma.account.findUnique({ where: { type_id: { type: 'github', id: '9999' } } });
  assert.equal(account.role, 'owner');
});

test('the owner list shows profiles read from the platform, for the session platform only', async () => {
  await prisma.account.create({ data: { type: 'gitlab', id: '7' } });
  try {
    const github = await (await call('/api/admin/accounts', { token: 'gh-stranger', platform: 'github' })).json();
    assert.equal(github.every((a) => a.platform === 'github'), true);
    assert.deepEqual(
      github.filter((a) => a.id === '9999').map((a) => [a.login, a.role]),
      [['stranger', 'owner']]
    );
    const gitlab = await (await call('/api/admin/accounts', { token: 'gl-dave', platform: 'gitlab' })).json();
    assert.equal(gitlab.every((a) => a.platform === 'gitlab'), true);
    const carol = gitlab.find((a) => a.id === '7');
    assert.deepEqual([carol.login, carol.name, carol.avatarUrl], ['carol', 'Carol', 'https://gitlab.example/7.png']);
  } finally {
    await prisma.account.deleteMany({ where: { type: 'gitlab', id: { in: ['7', '8'] } } });
  }
});
