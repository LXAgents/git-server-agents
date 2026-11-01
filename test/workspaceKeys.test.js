// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

// src/ is required after the mock starts, so the config points at it.
let prisma;
let encrypt;
let getWorkspaceKeys;
let findWorkspaceKeys;
let NoWorkspaceKeyError;

const USER = { type: 'github', id: 'wskey-user' };
let installation;
let repository;
let mock;
let server;
let base;

function call(method, path, { token, platform = 'github', body } = {}) {
  return fetch(`${base}/api/user${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-platform': platform, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { type: USER.type, id: USER.id } });
  await prisma.appInstallation.deleteMany({ where: { orgName: 'acme', platform: 'github' } });
  await prisma.workspaceKey.deleteMany({ where: { accountType: 'github', accountId: { in: ['1001', '1002'] } } });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  ({ encrypt } = require('../src/services/cryptoService'));
  ({ getWorkspaceKeys, findWorkspaceKeys, NoWorkspaceKeyError } = require('../src/services/workspaceKeyService'));
  await cleanup();
  await prisma.account.create({ data: { type: USER.type, id: USER.id } });
  installation = await prisma.appInstallation.create({ data: { platform: 'github', orgName: 'wskey-org', accountType: USER.type, accountId: USER.id } });
  repository = await prisma.repository.create({
    data: { platform: 'github', externalId: 'wskey-repo', fullName: 'wskey-org/web', appInstallationId: installation.id },
  });
  const add = (owner, plain, priority, isActive = true) =>
    prisma.workspaceKey.create({ data: { ...owner, provider: 'github_codespaces', tokenEncrypted: encrypt(plain), priority, isActive } });
  await add({ accountType: USER.type, accountId: USER.id }, 'user-low', 1);
  await add({ accountType: USER.type, accountId: USER.id }, 'user-high', 9);
  await add({ accountType: USER.type, accountId: USER.id }, 'user-off', 99, false);
  await add({ appInstallationId: installation.id }, 'org-key', 0);
  await add({ repositoryId: repository.id }, 'repo-low', 0);
  await add({ repositoryId: repository.id }, 'repo-high', 5);

  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await cleanup();
  await prisma.$disconnect();
});

const revealAll = (keys) => Promise.all(keys.map(async (k) => [k.owner, await k.reveal()]));

test('falls back repo -> org -> user, each by priority, and skips inactive keys', async () => {
  const keys = await getWorkspaceKeys('github_codespaces', USER, installation, repository);
  assert.deepEqual(await revealAll(keys), [
    ['repo', 'repo-high'],
    ['repo', 'repo-low'],
    ['org', 'org-key'],
    ['user', 'user-high'],
    ['user', 'user-low'],
  ]);
  // Handles carry no token until reveal() is called.
  assert.equal(JSON.stringify(keys).includes('user-high'), false);
});

test('leaves out the groups the caller may not use', async () => {
  const keys = await getWorkspaceKeys('github_codespaces', USER, null, null);
  assert.deepEqual(
    keys.map((k) => k.owner),
    ['user', 'user']
  );
});

test('throws a 401 when there is no key, and findWorkspaceKeys returns []', async () => {
  const stranger = { type: 'github', id: 'nobody-here' };
  await assert.rejects(getWorkspaceKeys('github_codespaces', stranger, null, null), (err) => err instanceof NoWorkspaceKeyError && err.status === 401 && /codespace scope/.test(err.message));
  assert.deepEqual(await findWorkspaceKeys('github_codespaces', stranger, null, null), []);
  await assert.rejects(getWorkspaceKeys('nope', stranger, null, null), { status: 400 });
});

test('a key switched off after listing refuses to reveal', async () => {
  const [first] = await getWorkspaceKeys('github_codespaces', USER, null, null);
  await prisma.workspaceKey.update({ where: { id: first.id }, data: { isActive: false } });
  await assert.rejects(first.reveal(), { status: 401 });
  await prisma.workspaceKey.update({ where: { id: first.id }, data: { isActive: true } });
});

test('users manage only their own workspace keys; views show the last four characters', async () => {
  const created = await call('POST', '/workspace-keys', { token: 'gh-bob', body: { token: 'ghp_codespaceBOB1', priority: 2 } });
  assert.equal(created.status, 201);
  const key = await created.json();
  assert.deepEqual([key.owner.type, key.owner.id, key.last4, key.providerSlug], ['user', '1002', 'BOB1', 'github_codespaces']);
  assert.equal(JSON.stringify(key).includes('codespaceBOB1'), false);

  assert.deepEqual((await (await call('GET', '/workspace-keys', { token: 'gh-bob' })).json()).map((k) => k.id), [key.id]);
  assert.deepEqual(await (await call('GET', '/workspace-keys', { token: 'gh-alice' })).json(), []);
  assert.equal((await call('DELETE', `/workspace-keys/${key.id}`, { token: 'gh-alice' })).status, 404);
  assert.equal((await call('DELETE', `/workspace-keys/${key.id}`, { token: 'gh-bob' })).status, 204);
  assert.equal((await call('POST', '/workspace-keys', { token: 'gh-bob', body: {} })).status, 400);
  // AI keys and workspace keys stay apart.
  assert.deepEqual(await (await call('GET', '/keys', { token: 'gh-bob' })).json(), []);
});

test('GitLab users cannot add Codespaces keys', async () => {
  const res = await call('POST', '/workspace-keys', { token: 'gl-carol', platform: 'gitlab', body: { token: 'x' } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /github only/);
});

test('only an org owner sees or changes org workspace keys', async () => {
  const org = await prisma.appInstallation.create({ data: { platform: 'github', orgName: 'acme', installationId: '555', accountType: 'github', accountId: '1001' } });
  assert.equal((await call('POST', `/orgs/${org.id}/workspace-keys`, { token: 'gh-bob', body: { token: 'ghp_x' } })).status, 403);
  const created = await call('POST', `/orgs/${org.id}/workspace-keys`, { token: 'gh-alice', body: { token: 'ghp_acme9876' } });
  assert.equal(created.status, 201);
  const key = await created.json();
  assert.deepEqual([key.owner.type, key.owner.name, key.last4], ['org', 'acme', '9876']);
  assert.equal((await call('GET', `/orgs/${org.id}/workspace-keys`, { token: 'gh-bob' })).status, 403);
  assert.equal((await call('DELETE', `/orgs/${org.id}/workspace-keys/${key.id}`, { token: 'gh-alice' })).status, 204);
});
