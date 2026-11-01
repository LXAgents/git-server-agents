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
  models = require('../src/services/ai/modelService');
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

const OR = (model) => ({ provider: 'openrouter', model });

test('sets and clears the user and org model, and validates input', async () => {
  const put = (path, token, body) => call('PUT', path, { token, body });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'text', model: 'anthropic/claude-x' })), { text: OR('anthropic/claude-x') });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'image', model: 'google/imagen' })), {
    text: OR('anthropic/claude-x'),
    image: OR('google/imagen'),
  });
  assert.deepEqual(await json(await put('/models/settings', 'gh-bob', { modality: 'image', model: null })), { text: OR('anthropic/claude-x') });
  assert.equal((await put('/models/settings', 'gh-bob', { modality: 'smell', model: 'a/b' })).status, 400);
  assert.equal((await put('/models/settings', 'gh-bob', { modality: 'text', model: 'not a model' })).status, 400);

  const org = orgs.acme.id;
  assert.equal((await put(`/orgs/${org}/models`, 'gh-bob', { modality: 'text', model: 'openai/gpt-5' })).status, 403);
  assert.deepEqual(await json(await put(`/orgs/${org}/models`, 'gh-alice', { modality: 'text', model: 'openai/gpt-5' })), { text: OR('openai/gpt-5') });
  const list = await json(await call('GET', '/orgs', { token: 'gh-alice' }));
  assert.deepEqual(list.find((o) => o.id === org).models, { text: OR('openai/gpt-5') });
});

test('each level stores a provider with its model, checked against that provider', async () => {
  const put = (path, token, body) => call('PUT', path, { token, body });
  const set = await put('/models/settings', 'gh-bob', { modality: 'text', provider: 'anthropic', model: 'claude-opus-5-5' });
  assert.equal(set.status, 200);
  assert.deepEqual(await json(set), { text: { provider: 'anthropic', model: 'claude-opus-5-5' } });
  // Display names work too, and OpenRouter ids still need vendor/name.
  assert.deepEqual((await json(await put('/models/settings', 'gh-bob', { modality: 'text', provider: 'DeepSeek', model: 'deepseek-chat' }))).text, {
    provider: 'deepseek',
    model: 'deepseek-chat',
  });
  assert.equal((await put('/models/settings', 'gh-bob', { modality: 'text', provider: 'openrouter', model: 'gpt-5' })).status, 400);
  const unknown = await put('/models/settings', 'gh-bob', { modality: 'text', provider: 'acme-ai', model: 'x' });
  assert.equal(unknown.status, 400);
  assert.match((await json(unknown)).error, /openrouter, openai, anthropic, deepseek, zai/);
  assert.deepEqual(await json(await call('GET', '/models/settings', { token: 'gh-bob' })), { text: { provider: 'deepseek', model: 'deepseek-chat' } });
  await put('/models/settings', 'gh-bob', { modality: 'text', model: null });
});

test('@lxagents resolves the repo provider and model, then the org, then the user, then the default', async () => {
  const repo = await prisma.repository.create({
    data: { platform: 'github', externalId: 'resolve-1', fullName: 'acme/resolve', appInstallationId: orgs.acme.id },
  });
  const account = { type: 'github', id: '1001' };
  const ctx = { repository: repo, installation: orgs.acme, account };
  await models.setModel({ appInstallationId: orgs.acme.id }, { modality: 'text', model: null });
  await models.setModel({ accountType: 'github', accountId: '1001' }, { modality: 'text', model: null });

  assert.deepEqual(await models.resolveModel(ctx), { provider: 'openrouter', model: 'openrouter/free', source: 'default' });
  await models.setModel({ accountType: 'github', accountId: '1001' }, { modality: 'text', model: 'user/model' });
  assert.deepEqual(await models.resolveModel(ctx), { provider: 'openrouter', model: 'user/model', source: 'user' });
  await models.setModel({ appInstallationId: orgs.acme.id }, { modality: 'text', provider: 'openai', model: 'gpt-5' });
  assert.deepEqual(await models.resolveModel(ctx), { provider: 'openai', model: 'gpt-5', source: 'org' });
  await models.setModel({ repositoryId: repo.id }, { modality: 'text', provider: 'zai', model: 'glm-4.6' });
  assert.deepEqual(await models.resolveModel(ctx), { provider: 'zai', model: 'glm-4.6', source: 'repo' });
  // Another modality never leaks into text.
  await models.setModel({ repositoryId: repo.id }, { modality: 'text', model: null });
  await models.setModel({ repositoryId: repo.id }, { modality: 'image', model: 'img/model' });
  assert.deepEqual(await models.resolveModel(ctx), { provider: 'openai', model: 'gpt-5', source: 'org' });
});

test('lists the five providers for the dropdown', async () => {
  const list = await json(await call('GET', '/providers', { token: 'gh-bob' }));
  assert.deepEqual(list.map((p) => p.id), ['openrouter', 'openai', 'anthropic', 'deepseek', 'zai']);
  assert.equal(list.find((p) => p.id === 'openrouter').keyForModels, false);
  assert.equal(list.find((p) => p.id === 'anthropic').name, 'Anthropic');
});

test('lists a provider\'s models live with the caller\'s own key, never a server key', async () => {
  models.clearCache();
  const noKey = await call('GET', '/models?modality=text&provider=openai', { token: 'gh-bob' });
  assert.equal(noKey.status, 400);
  assert.match((await json(noKey)).error, /add a OpenAI key first/);

  const bad = await call('POST', '/keys', { token: 'gh-bob', body: { apiKey: 'sk-openai-bad', provider: 'openai' } });
  assert.equal(bad.status, 201);
  assert.equal((await call('GET', '/models?modality=text&provider=openai', { token: 'gh-bob' })).status, 502);
  await call('DELETE', `/keys/${(await json(bad)).id}`, { token: 'gh-bob' });

  const key = await json(await call('POST', '/keys', { token: 'gh-bob', body: { apiKey: 'sk-openai-good', provider: 'openai' } }));
  assert.equal(key.provider, 'OpenAI');
  assert.equal(key.providerSlug, 'openai');
  const list = await json(await call('GET', '/models?modality=text&provider=openai', { token: 'gh-bob' }));
  assert.deepEqual(list.map((m) => [m.id, m.provider]), [
    ['gpt-5', 'openai'],
    ['gpt-5-mini', 'openai'],
  ]);

  await call('POST', '/keys', { token: 'gh-bob', body: { apiKey: 'sk-ant-good', provider: 'anthropic' } });
  const claude = await json(await call('GET', '/models?modality=text&provider=anthropic', { token: 'gh-bob' }));
  assert.deepEqual(claude.map((m) => [m.id, m.name, m.contextLength]), [
    ['claude-haiku-5-5', 'Claude Haiku 5.5', null],
    ['claude-opus-5-5', 'Claude Opus 5.5', 1000000],
  ]);

  // z.ai without a /models endpoint falls back to its published GLM models.
  await call('POST', '/keys', { token: 'gh-bob', body: { apiKey: 'zai-key', provider: 'z.ai' } });
  const glm = await json(await call('GET', '/models?modality=text&provider=zai', { token: 'gh-bob' }));
  assert.ok(glm.some((m) => m.id === 'glm-4.6' && m.provider === 'zai'));

  // An org's key is used only for its owner.
  const org = orgs.acme.id;
  assert.equal((await call('GET', `/models?modality=text&provider=deepseek&orgId=${org}`, { token: 'gh-bob' })).status, 403);
  await call('POST', `/orgs/${org}/keys`, { token: 'gh-alice', body: { apiKey: 'ds-org-key', provider: 'deepseek' } });
  const ds = await json(await call('GET', `/models?modality=text&provider=deepseek&orgId=${org}`, { token: 'gh-alice' }));
  assert.deepEqual(ds.map((m) => m.id), ['deepseek-chat', 'deepseek-reasoner']);

  assert.equal((await call('GET', '/models?modality=text&provider=acme-ai', { token: 'gh-bob' })).status, 400);
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
