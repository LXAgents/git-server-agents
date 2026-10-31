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
let models;

// alice (GitHub 1001) owns acme; bob (1002) is an acme member. carol (GitLab 7) owns grp.
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
  models = require('../src/services/modelService');
  const { createApp } = require('../src/app');
  await cleanup();
  for (const [type, id, username] of WHITELIST) await prisma.account.create({ data: { type, id, username } });
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

test('sets and clears the user and org model, and validates input', async () => {
  const put = (path, token, body) => call('PUT', path, { token, body });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'text', model: 'anthropic/claude-x' })), { text: 'anthropic/claude-x' });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'image', model: 'google/imagen' })), {
    text: 'anthropic/claude-x',
    image: 'google/imagen',
  });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'image', model: null })), { text: 'anthropic/claude-x' });
  assert.equal((await put('/models/settings', 'gh-bob', { modality: 'smell', model: 'a/b' })).status, 400);
  assert.equal((await put('/models/settings', 'gh-bob', { modality: 'text', model: 'not a model' })).status, 400);

  const org = orgs.acme.id;
  assert.equal((await put(`/orgs/${org}/models`, 'gh-bob', { modality: 'text', model: 'openai/gpt-5' })).status, 403);
  assert.deepEqual(await json(await put(`/orgs/${org}/models`, 'gh-alice', { modality: 'text', model: 'openai/gpt-5' })), { text: 'openai/gpt-5' });
  const list = await json(await call('GET', '/orgs', { token: 'gh-alice' }));
  assert.deepEqual(list.find((o) => o.id === org).models, { text: 'openai/gpt-5' });
});

test('@agents resolves the repo model, then the org, then the user, then the default', async () => {
  const repo = await prisma.repository.create({
    data: { platform: 'github', externalId: 'resolve-1', fullName: 'acme/resolve', appInstallationId: orgs.acme.id },
  });
  const account = { type: 'github', id: '1001' };
  const ctx = { repository: repo, installation: orgs.acme, account };
  await models.setModel({ appInstallationId: orgs.acme.id }, { modality: 'text', model: null });
  await models.setModel({ accountType: 'github', accountId: '1001' }, { modality: 'text', model: null });

  assert.deepEqual(await models.resolveModel(ctx), { model: 'openrouter/free', source: 'default' });
  await models.setModel({ accountType: 'github', accountId: '1001' }, { modality: 'text', model: 'user/model' });
  assert.deepEqual(await models.resolveModel(ctx), { model: 'user/model', source: 'user' });
  await models.setModel({ appInstallationId: orgs.acme.id }, { modality: 'text', model: 'org/model' });
  assert.deepEqual(await models.resolveModel(ctx), { model: 'org/model', source: 'org' });
  await models.setModel({ repositoryId: repo.id }, { modality: 'text', model: 'repo/model' });
  assert.deepEqual(await models.resolveModel(ctx), { model: 'repo/model', source: 'repo' });
  // Another modality never leaks into text.
  await models.setModel({ repositoryId: repo.id }, { modality: 'text', model: null });
  await models.setModel({ repositoryId: repo.id }, { modality: 'image', model: 'img/model' });
  assert.deepEqual(await models.resolveModel(ctx), { model: 'org/model', source: 'org' });
});

test('lists OpenRouter text models live; other modalities are not available yet', async () => {
  models.clearCache();
  const list = await json(await call('GET', '/models?modality=text', { token: 'gh-bob' }));
  assert.deepEqual(
    list.map((m) => [m.id, m.free]),
    [
      ['openai/gpt-5', false],
      ['openrouter/free', true],
    ]
  );
  assert.equal(list[0].contextLength, 400000);
  assert.equal((await call('GET', '/models?modality=image', { token: 'gh-bob' })).status, 400);
  assert.equal((await call('GET', '/models?modality=text')).status, 401);
});
