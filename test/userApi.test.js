// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

let mock;
let server;
let base;
let prisma;

// Whitelisted users from the mock platform: alice (GitHub 1001, owns acme), bob (GitHub 1002,
// member of acme), carol (GitLab 7, owns grp), dave (GitLab 8, developer in grp).
const WHITELIST = [
  ['github', '1001', 'alice'],
  ['github', '1002', 'bob'],
  ['gitlab', '7', 'carol'],
  ['gitlab', '8', 'dave'],
];

function call(method, path, { token, platform = 'github', body } = {}) {
  return fetch(`${base}/api/user${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-platform': platform, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function cleanup() {
  await prisma.appInstallation.deleteMany({ where: { orgName: { in: ['acme', 'alice', 'grp', 'no-app'] } } });
  for (const [type, id] of WHITELIST) await prisma.account.deleteMany({ where: { type, id } });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  const { createApp } = require('../src/app');
  await cleanup();
  for (const [type, id, username] of WHITELIST) await prisma.account.create({ data: { type, id, username } });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await cleanup();
  await prisma.$disconnect();
});

test('signs in with the platform token and requires a whitelisted user', async () => {
  const me = await call('GET', '/me', { token: 'gh-alice' });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { platform: 'github', id: '1001', login: 'alice', username: 'alice', isAdmin: false });
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'bogus' })).status, 401);
  assert.equal((await call('GET', '/me', { token: 'gh-stranger' })).status, 403);
  assert.equal((await call('GET', '/me', { token: 'gh-alice', platform: 'svn' })).status, 400);
});

test('lets any whitelisted user manage only their own keys', async () => {
  const created = await call('POST', '/keys', { token: 'gh-bob', body: { apiKey: 'sk-bob-0001', priority: 4 } });
  assert.equal(created.status, 201);
  const key = await created.json();
  assert.deepEqual([key.owner.type, key.owner.id, key.last4], ['user', '1002', '0001']);

  assert.deepEqual((await (await call('GET', '/keys', { token: 'gh-bob' })).json()).map((k) => k.id), [key.id]);
  assert.deepEqual(await (await call('GET', '/keys', { token: 'gh-alice' })).json(), []);
  assert.equal((await call('DELETE', `/keys/${key.id}`, { token: 'gh-alice' })).status, 404);
  assert.equal((await call('DELETE', `/keys/${key.id}`, { token: 'gh-bob' })).status, 204);
});

test('lists importable orgs with the reason an org cannot be imported', async () => {
  const list = await (await call('GET', '/orgs/importable', { token: 'gh-alice' })).json();
  assert.deepEqual(
    list.map((o) => [o.name, o.importable, o.reason]),
    [
      ['alice', true, null],
      ['acme', true, null],
      ['no-app', false, 'GitHub App is not installed'],
    ]
  );
});

test('imports an org only for an owner, and only once', async () => {
  assert.equal((await call('POST', '/orgs/import', { token: 'gh-bob', body: { orgName: 'acme' } })).status, 403);
  assert.equal((await call('POST', '/orgs/import', { token: 'gh-alice', body: { orgName: 'no-app' } })).status, 400);
  assert.equal((await call('POST', '/orgs/import', { token: 'gh-alice', body: {} })).status, 400);

  const imported = await call('POST', '/orgs/import', { token: 'gh-alice', body: { orgName: 'ACME' } });
  assert.equal(imported.status, 201);
  const org = await imported.json();
  assert.deepEqual([org.orgName, org.installationId, org.owner.id], ['acme', '555', '1001']);
  assert.equal((await call('POST', '/orgs/import', { token: 'gh-alice', body: { orgName: 'acme' } })).status, 409);

  const importable = await (await call('GET', '/orgs/importable', { token: 'gh-alice' })).json();
  assert.equal(importable.find((o) => o.name === 'acme').reason, 'already imported');
  assert.deepEqual((await (await call('GET', '/orgs', { token: 'gh-alice' })).json()).map((o) => o.orgName), ['acme']);
  assert.deepEqual(await (await call('GET', '/orgs', { token: 'gh-bob' })).json(), []);
});

test('lets only an owner see or change org keys, checked on every call', async () => {
  const org = await prisma.appInstallation.findUnique({ where: { platform_orgName: { platform: 'github', orgName: 'acme' } } });

  assert.equal((await call('POST', `/orgs/${org.id}/keys`, { token: 'gh-bob', body: { apiKey: 'sk-x' } })).status, 403);
  assert.equal((await call('GET', `/orgs/${org.id}/keys`, { token: 'gh-bob' })).status, 403);

  const created = await call('POST', `/orgs/${org.id}/keys`, { token: 'gh-alice', body: { apiKey: 'sk-acme-4242', priority: 7 } });
  assert.equal(created.status, 201);
  const key = await created.json();
  assert.deepEqual([key.owner.type, key.owner.name, key.last4], ['org', 'acme', '4242']);

  assert.equal((await call('DELETE', `/orgs/${org.id}/keys/${key.id}`, { token: 'gh-bob' })).status, 403);
  assert.equal((await call('GET', `/orgs/${org.id}/keys`, { token: 'gh-alice' })).status, 200);
  assert.equal((await call('DELETE', `/orgs/${org.id}/keys/${key.id}`, { token: 'gh-alice' })).status, 204);
  assert.equal((await call('GET', `/orgs/missing/keys`, { token: 'gh-alice' })).status, 404);
});

test('checks GitLab group ownership the same way', async () => {
  assert.equal((await call('POST', '/orgs/import', { token: 'gl-dave', platform: 'gitlab', body: { orgName: 'grp' } })).status, 403);
  const imported = await call('POST', '/orgs/import', { token: 'gl-carol', platform: 'gitlab', body: { orgName: 'grp' } });
  assert.equal(imported.status, 201);
  const org = await imported.json();
  assert.equal(org.installationId, null);

  assert.equal((await call('POST', `/orgs/${org.id}/keys`, { token: 'gl-dave', platform: 'gitlab', body: { apiKey: 'k' } })).status, 403);
  assert.equal((await call('DELETE', `/orgs/${org.id}`, { token: 'gl-dave', platform: 'gitlab' })).status, 403);
  // A GitHub user cannot reach a GitLab org at all.
  assert.equal((await call('DELETE', `/orgs/${org.id}`, { token: 'gh-alice' })).status, 404);
  assert.equal((await call('DELETE', `/orgs/${org.id}`, { token: 'gl-carol', platform: 'gitlab' })).status, 204);
});
