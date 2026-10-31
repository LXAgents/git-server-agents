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

// alice (GitHub 1001) owns acme and administers acme/web (301) and beta/app (303), but not
// acme/docs. bob (1002) is an acme member without admin. carol (GitLab 7) owns grp and its
// project grp/app (41); dave (8) is a developer there.
const WHITELIST = [
  ['github', '1001', 'alice'],
  ['github', '1002', 'bob'],
  ['gitlab', '7', 'carol'],
  ['gitlab', '8', 'dave'],
];
const ORGS = [
  ['github', 'acme', '1001'],
  ['gitlab', 'grp', '7'],
];

function call(method, path, { token, platform = 'github', body } = {}) {
  return fetch(`${base}/api/user${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-platform': platform, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const json = async (res) => res.json();

async function cleanup() {
  await prisma.appInstallation.deleteMany({ where: { orgName: { in: ORGS.map((o) => o[1]) } } });
  for (const [type, id] of WHITELIST) await prisma.account.deleteMany({ where: { type, id } });
}

const orgs = {};

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  const { createApp } = require('../src/app');
  await cleanup();
  for (const [type, id] of WHITELIST) await prisma.account.create({ data: { type, id } });
  for (const [platform, orgName, owner] of ORGS) {
    orgs[orgName] = await prisma.appInstallation.create({ data: { platform, orgName, accountType: platform, accountId: owner } });
  }
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await cleanup();
  await prisma.$disconnect();
});

test('lists repos the user administers, with why one cannot be imported', async () => {
  const list = await json(await call('GET', '/repos/importable', { token: 'gh-alice' }));
  assert.deepEqual(
    list.map((r) => [r.fullName, r.importable, r.reason]),
    [
      ['acme/web', true, null],
      ['beta/app', false, 'organization not imported'],
    ]
  );
});

test('imports a repo only for its admin, and checks admin rights on every change', async () => {
  assert.equal((await call('POST', '/repos/import', { token: 'gh-bob', body: { externalId: '301' } })).status, 403);
  assert.equal((await call('POST', '/repos/import', { token: 'gh-alice', body: { externalId: '303' } })).status, 400);
  const created = await call('POST', '/repos/import', { token: 'gh-alice', body: { externalId: '301' } });
  assert.equal(created.status, 201);
  const repo = await created.json();
  assert.deepEqual([repo.fullName, repo.org.name], ['acme/web', 'acme']);
  assert.equal((await call('POST', '/repos/import', { token: 'gh-alice', body: { externalId: '301' } })).status, 409);

  assert.deepEqual((await json(await call('GET', '/repos', { token: 'gh-alice' }))).map((r) => r.id), [repo.id]);
  assert.deepEqual(await json(await call('GET', '/repos', { token: 'gh-bob' })), []);

  // Keys and models: alice yes, bob no.
  const key = await call('POST', `/repos/${repo.id}/keys`, { token: 'gh-alice', body: { apiKey: 'sk-repo-0301' } });
  assert.equal(key.status, 201);
  assert.deepEqual((await key.json()).owner, { type: 'repo', id: repo.id, platform: 'github', name: 'acme/web' });
  assert.equal((await call('GET', `/repos/${repo.id}/keys`, { token: 'gh-bob' })).status, 403);
  assert.equal((await call('PUT', `/repos/${repo.id}/models`, { token: 'gh-bob', body: { modality: 'text', model: 'openai/gpt-5' } })).status, 403);

  const set = await call('PUT', `/repos/${repo.id}/models`, { token: 'gh-alice', body: { modality: 'text', model: 'openai/gpt-5' } });
  assert.deepEqual(await set.json(), { text: 'openai/gpt-5' });
  assert.deepEqual((await json(await call('GET', '/repos', { token: 'gh-alice' })))[0].models, { text: 'openai/gpt-5' });

  assert.equal((await call('DELETE', `/repos/${repo.id}`, { token: 'gh-bob' })).status, 403);
  assert.equal((await call('DELETE', `/repos/${repo.id}`, { token: 'gh-alice' })).status, 204);
  assert.equal(await prisma.accountKey.count({ where: { repositoryId: repo.id } }), 0);
});

test('GitLab projects need Maintainer or above', async () => {
  assert.equal((await call('POST', '/repos/import', { token: 'gl-dave', platform: 'gitlab', body: { externalId: '41' } })).status, 403);
  const created = await call('POST', '/repos/import', { token: 'gl-carol', platform: 'gitlab', body: { externalId: '41' } });
  assert.equal(created.status, 201);
  const repo = await created.json();
  assert.equal(repo.fullName, 'grp/app');
  assert.equal((await call('GET', `/repos/${repo.id}/models`, { token: 'gl-dave', platform: 'gitlab' })).status, 403);
  assert.deepEqual(await json(await call('GET', `/repos/${repo.id}/models`, { token: 'gl-carol', platform: 'gitlab' })), {});
});

test('finds the repository a webhook came from only inside its own org', async () => {
  const { findForEvent } = require('../src/services/repoStore');
  const repo = await prisma.repository.create({
    data: { platform: 'gitlab', externalId: '4242', fullName: 'grp/other', appInstallationId: orgs.grp.id },
  });
  assert.equal((await findForEvent('gitlab', { project: { id: 4242 } }, orgs.grp)).id, repo.id);
  assert.equal(await findForEvent('gitlab', { project: { id: 4242 } }, orgs.acme), null);
  assert.equal(await findForEvent('github', { repository: { id: 1 } }, orgs.acme), null);
});
