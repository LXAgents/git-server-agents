// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` and `db:seed` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGINS = 'http://dashboard.test';
// The owners: stranger (GitHub 9999) and dave (GitLab 8), signed in with their own tokens.
process.env.GITHUB_ADMIN_ID = '9999';
process.env.GITLAB_ADMIN_ID = '8';
const OWNER_TOKENS = { github: 'gh-stranger', gitlab: 'gl-dave' };

const P = 'adminapi';
let mock;
let prisma;
let server;
let base;

function call(method, path, { body, platform = 'github', token = OWNER_TOKENS[platform], headers = {} } = {}) {
  return fetch(`${base}/api/admin${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(platform ? { 'x-platform': platform } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await prisma.account.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.account.deleteMany({ where: { OR: [{ type: 'github', id: '9999' }, { type: 'gitlab', id: '8' }] } });
  await prisma.$disconnect();
});

test("opens only for the platform owner's own token", async () => {
  assert.equal((await call('GET', '/accounts')).status, 200);
  assert.equal((await call('GET', '/accounts', { platform: 'gitlab' })).status, 200);
  // No X-Platform, no token, a bad token, or a valid user who is not the owner.
  assert.equal((await call('GET', '/accounts', { platform: null, token: 'gh-stranger' })).status, 401);
  assert.equal((await call('GET', '/accounts', { token: null })).status, 401);
  assert.equal((await call('GET', '/accounts', { token: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/accounts', { platform: 'bitbucket', token: 'gh-stranger' })).status, 400);
  await prisma.account.create({ data: { type: 'github', id: '1001' } });
  try {
    assert.equal((await call('GET', '/accounts', { token: 'gh-alice' })).status, 403);
  } finally {
    await prisma.account.deleteMany({ where: { type: 'github', id: '1001' } });
  }
});

test('an ADMIN_TOKEN left in the environment opens nothing', async () => {
  process.env.ADMIN_TOKEN = 'left-over';
  try {
    assert.equal((await call('GET', '/accounts', { token: 'left-over', platform: null })).status, 401);
    assert.equal((await call('GET', '/accounts', { token: 'left-over' })).status, 401);
  } finally {
    delete process.env.ADMIN_TOKEN;
  }
});

test('answers CORS preflight for the dashboard origin only', async () => {
  const ok = await fetch(`${base}/api/admin/accounts`, { method: 'OPTIONS', headers: { origin: 'http://dashboard.test' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://dashboard.test');
  const other = await fetch(`${base}/api/admin/accounts`, { method: 'OPTIONS', headers: { origin: 'http://evil.test' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('creates, lists and deletes accounts', async () => {
  const created = await call('POST', '/accounts', { body: { userId: `${P}-1` } });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).role, 'member');
  assert.equal((await call('POST', '/accounts', { body: { userId: `${P}-1` } })).status, 409);
  assert.equal((await call('POST', '/accounts', { body: { userId: `${P}-3`, role: 'Admin' } })).status, 400);
  assert.equal((await call('POST', '/accounts', { body: {} })).status, 400);
  // One owner per platform, set by GITHUB_ADMIN_ID: the API only adds members.
  assert.equal((await call('POST', '/accounts', { body: { userId: `${P}-4`, role: 'OWNER' } })).status, 400);
  assert.equal((await call('POST', '/accounts', { body: { userId: `${P}-5`, role: 'member' } })).status, 201);

  const list = await (await call('GET', '/accounts')).json();
  const row = list.find((a) => a.id === `${P}-1`);
  // No profile on the platform for this ID, so the ID stands in for the login.
  assert.deepEqual([row.platform, row.login, row.role, row.keyCount, row.orgCount], ['github', `${P}-1`, 'member', 0, 0]);
  assert.equal('username' in row, false);

  // A GitLab session neither sees nor deletes GitHub accounts.
  const gitlab = await (await call('GET', '/accounts', { platform: 'gitlab' })).json();
  assert.equal(gitlab.some((a) => a.id === `${P}-1`), false);
  assert.equal((await call('DELETE', `/accounts/github/${P}-1`, { platform: 'gitlab' })).status, 404);

  assert.equal((await call('DELETE', `/accounts/github/${P}-1`)).status, 204);
  assert.equal((await call('DELETE', `/accounts/github/${P}-1`)).status, 404);
});

test('has no way to create an org', async () => {
  assert.equal((await call('POST', '/orgs', { body: { platform: 'github', orgName: 'x' } })).status, 404);
});

test('lists and deletes orgs, and manages user and org keys without exposing them', async () => {
  await prisma.account.create({ data: { type: 'github', id: `${P}-2` } });
  const org = await prisma.appInstallation.create({
    data: { platform: 'github', orgName: `${P}-org`, accountType: 'github', accountId: `${P}-2` },
  });

  const orgs = await (await call('GET', '/orgs')).json();
  assert.equal(orgs.find((o) => o.id === org.id).owner.login, `${P}-2`);
  // The GitLab view has no GitHub orgs, and can't delete one.
  assert.equal((await (await call('GET', '/orgs', { platform: 'gitlab' })).json()).some((o) => o.id === org.id), false);
  assert.equal((await call('DELETE', `/orgs/${org.id}`, { platform: 'gitlab' })).status, 404);

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
  assert.ok(keys.some((k) => k.id === userView.id));
  const gitlabKeys = await (await call('GET', '/keys', { platform: 'gitlab' })).json();
  assert.equal(gitlabKeys.some((k) => k.id === orgKey.id || k.id === userView.id), false);
  assert.equal((await call('POST', '/keys', { platform: 'gitlab', body: { target: 'org', appInstallationId: org.id, apiKey: 'k' } })).status, 400);
  assert.equal((await call('DELETE', `/keys/${orgKey.id}`, { platform: 'gitlab' })).status, 404);
  assert.equal(JSON.stringify(keys).includes('apiKeyEncrypted'), false);

  assert.equal((await call('DELETE', `/keys/${orgKey.id}`)).status, 204);
  assert.equal((await call('DELETE', `/keys/${orgKey.id}`)).status, 404);
  assert.equal((await call('DELETE', `/orgs/${org.id}`)).status, 204);
  assert.equal((await call('DELETE', `/orgs/${org.id}`)).status, 404);
});
