// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

const prisma = require('../src/db');
const { encrypt } = require('../src/services/cryptoService');
const { getProviderKeys } = require('../src/services/keyService');

const USER = { type: 'github', id: 'keysvc-user' };
let installation;
let repository;
let provider;

test.before(async () => {
  provider = await prisma.provider.findFirst({ where: { displayName: 'OpenRouter' } });
  assert.ok(provider, 'run npm run db:seed first');
  await prisma.account.create({ data: { type: USER.type, id: USER.id } });
  installation = await prisma.appInstallation.create({
    data: { platform: 'github', orgName: 'keysvc-org', accountType: USER.type, accountId: USER.id },
  });
  repository = await prisma.repository.create({
    data: { platform: 'github', externalId: 'keysvc-repo', fullName: 'keysvc-org/web', appInstallationId: installation.id },
  });
  const add = (owner, plain, priority, isActive = true) =>
    prisma.accountKey.create({
      data: { ...owner, providerId: provider.id, apiKeyEncrypted: encrypt(plain), priority, isActive },
    });
  const user = { accountType: USER.type, accountId: USER.id };
  const org = { appInstallationId: installation.id };
  await add(user, 'user-low', 1);
  await add(user, 'user-high', 9);
  await add(user, 'user-off', 99, false);
  await add(org, 'org-high', 50);
  await add(org, 'org-low', 0);
  await add({ repositoryId: repository.id }, 'repo-key', 0);
  await prisma.accountKey.create({
    data: { ...org, providerId: provider.id, apiKeyEncrypted: 'v1:not:valid:data', priority: 100 },
  });
});

test.after(async () => {
  await prisma.account.delete({ where: { type_id: USER } });
  await prisma.$disconnect();
});

test('returns repo keys, then org keys, then user keys, each by priority, skipping inactive and unreadable', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { keys } = await getProviderKeys('OpenRouter', USER, installation, repository);
  assert.deepEqual(
    keys.map((k) => [k.owner, k.apiKey]),
    [
      ['repo', 'repo-key'],
      ['org', 'org-high'],
      ['org', 'org-low'],
      ['user', 'user-high'],
      ['user', 'user-low'],
    ]
  );
});

test('leaves out the repo and org keys when the commenter may not use them', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { keys } = await getProviderKeys('OpenRouter', USER, null, null);
  assert.deepEqual(keys.map((k) => k.owner), ['user', 'user']);
});

test('works with only a user or only an org', async () => {
  assert.equal((await getProviderKeys('OpenRouter', USER, null)).keys.length, 2);
  assert.equal((await getProviderKeys('OpenRouter', null, installation)).keys.length, 2);
});

test('fails clearly when the provider is missing', async () => {
  await assert.rejects(getProviderKeys('NoSuchProvider', USER, installation), /not configured/);
});
