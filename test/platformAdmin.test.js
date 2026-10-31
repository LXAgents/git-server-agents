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

test('ADMIN_TOKEN still opens the admin API', async () => {
  assert.equal((await call('/api/admin/accounts', { token: 'admin-test-token' })).status, 200);
});

test('an admin user is whitelisted on first sign-in and /me reports isAdmin', async () => {
  const res = await call('/api/user/me', { token: 'gh-stranger', platform: 'github' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { platform: 'github', id: '9999', login: 'stranger', username: 'stranger', isAdmin: true });
  const account = await prisma.account.findUnique({ where: { type_id: { type: 'github', id: '9999' } } });
  assert.equal(account.username, 'stranger');
});
