// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.ADMIN_TOKEN = 'admin-test-token';
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGINS = 'http://dashboard.test';

const prisma = require('../src/db');
const { createApp } = require('../src/app');

const P = 'adminapi';
let server;
let base;

function call(method, path, { body, token = 'admin-test-token', headers = {} } = {}) {
  return fetch(`${base}/api/admin${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await prisma.account.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.$disconnect();
});

test('rejects a missing or wrong token with 401', async () => {
  assert.equal((await call('GET', '/accounts', { token: null })).status, 401);
  assert.equal((await call('GET', '/accounts', { token: 'wrong' })).status, 401);
  const bare = await fetch(`${base}/api/admin/accounts`, { headers: { authorization: 'admin-test-token' } });
  assert.equal(bare.status, 200);
});

test('answers CORS preflight for the dashboard origin only', async () => {
  const ok = await fetch(`${base}/api/admin/accounts`, { method: 'OPTIONS', headers: { origin: 'http://dashboard.test' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://dashboard.test');
  const other = await fetch(`${base}/api/admin/accounts`, { method: 'OPTIONS', headers: { origin: 'http://evil.test' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('creates, lists and deletes accounts', async () => {
  const created = await call('POST', '/accounts', { body: { platform: 'github', userId: `${P}-1`, username: 'alice' } });
  assert.equal(created.status, 201);
  assert.equal((await call('POST', '/accounts', { body: { platform: 'github', userId: `${P}-1` } })).status, 409);
  assert.equal((await call('POST', '/accounts', { body: { platform: 'bitbucket', userId: 'x' } })).status, 400);
  assert.equal((await call('POST', '/accounts', { body: { platform: 'github' } })).status, 400);

  const list = await (await call('GET', '/accounts')).json();
  const row = list.find((a) => a.id === `${P}-1`);
  assert.deepEqual([row.platform, row.username, row.keyCount, row.orgCount], ['github', 'alice', 0, 0]);

  assert.equal((await call('DELETE', `/accounts/github/${P}-1`)).status, 204);
  assert.equal((await call('DELETE', `/accounts/github/${P}-1`)).status, 404);
});

test('has no way to create an org', async () => {
  assert.equal((await call('POST', '/orgs', { body: { platform: 'github', orgName: 'x' } })).status, 404);
});

test('lists and deletes orgs, and manages user and org keys without exposing them', async () => {
  await prisma.account.create({ data: { type: 'github', id: `${P}-2`, username: 'bob' } });
  const org = await prisma.appInstallation.create({
    data: { platform: 'github', orgName: `${P}-org`, accountType: 'github', accountId: `${P}-2` },
  });

  const orgs = await (await call('GET', '/orgs')).json();
  assert.equal(orgs.find((o) => o.id === org.id).owner.username, 'bob');

  const userKey = await call('POST', '/keys', {
    body: { target: 'user', platform: 'github', userId: `${P}-2`, apiKey: 'sk-or-user-1234', priority: 2 },
  });
  assert.equal(userKey.status, 201);
  const userView = await userKey.json();
  assert.deepEqual([userView.owner.type, userView.last4, userView.priority], ['user', '1234', 2]);
  assert.equal(JSON.stringify(userView).includes('sk-or-user'), false);

  const orgKey = await (
    await call('POST', '/keys', { body: { target: 'org', appInstallationId: org.id, apiKey: 'sk-or-org-9876' } })
  ).json();
  assert.deepEqual([orgKey.owner.type, orgKey.owner.name, orgKey.last4], ['org', `${P}-org`, '9876']);

  assert.equal((await call('POST', '/keys', { body: { target: 'org', appInstallationId: 'missing', apiKey: 'k' } })).status, 400);
  assert.equal((await call('POST', '/keys', { body: { target: 'user', platform: 'github', userId: 'ghost', apiKey: 'k' } })).status, 400);
  assert.equal((await call('POST', '/keys', { body: { target: 'team', apiKey: 'k' } })).status, 400);
  assert.equal((await call('POST', '/keys', { body: { target: 'org', appInstallationId: org.id } })).status, 400);

  const keys = await (await call('GET', '/keys')).json();
  assert.ok(keys.some((k) => k.id === orgKey.id));
  assert.equal(JSON.stringify(keys).includes('apiKeyEncrypted'), false);

  assert.equal((await call('DELETE', `/keys/${orgKey.id}`)).status, 204);
  assert.equal((await call('DELETE', `/keys/${orgKey.id}`)).status, 404);
  assert.equal((await call('DELETE', `/orgs/${org.id}`)).status, 204);
  assert.equal((await call('DELETE', `/orgs/${org.id}`)).status, 404);
});
