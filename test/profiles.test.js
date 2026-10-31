// Profiles come from the platform and are cached in memory only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockPlatform, profileLookups } = require('./helpers/mockPlatform');

let mock;
let profiles;

test.before(async () => {
  mock = await startMockPlatform();
  profiles = require('../src/services/profileService');
});

test.after(() => mock.close());

test.beforeEach(() => profiles.clear());

test('reads a GitHub or GitLab profile by numeric ID, without a token', async () => {
  assert.deepEqual(await profiles.getProfile('github', '1001'), {
    login: 'alice',
    name: 'Alice Liddell',
    avatarUrl: 'https://avatars.example/1001',
  });
  assert.deepEqual(await profiles.getProfile('gitlab', 7), { login: 'carol', name: 'Carol', avatarUrl: 'https://gitlab.example/7.png' });
});

test('asks the platform once, then answers from memory', async () => {
  const before = profileLookups.github;
  await profiles.getProfile('github', '1002');
  await profiles.getProfile('github', '1002');
  const many = await profiles.getProfiles('github', ['1002', '1002', 1002]);
  assert.equal(profileLookups.github - before, 1);
  assert.equal(many.get('1002').login, 'bob');
});

test('an unknown or non-numeric ID gives null, and a miss is not cached', async () => {
  const before = profileLookups.gitlab;
  assert.equal(await profiles.getProfile('gitlab', '404'), null);
  assert.equal(await profiles.getProfile('gitlab', '404'), null);
  assert.equal(profileLookups.gitlab - before, 2);
  assert.equal(await profiles.getProfile('github', '../user'), null);
  assert.deepEqual(profiles.describe('404', null), { login: '404', name: null, avatarUrl: null });
});
