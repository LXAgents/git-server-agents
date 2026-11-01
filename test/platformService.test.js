const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockPlatform } = require('./helpers/mockPlatform');

let mock;
let platforms;

test.before(async () => {
  mock = await startMockPlatform();
  platforms = require('../src/services/platforms/platformService');
});
test.after(() => mock.close());

test('identifies GitHub and GitLab users from their own token, with their public profile', async () => {
  assert.deepEqual(await platforms.getUser('github', 'gh-alice'), {
    platform: 'github',
    id: '1001',
    login: 'alice',
    name: 'Alice Liddell',
    avatarUrl: 'https://avatars.example/1001',
  });
  assert.deepEqual(await platforms.getUser('gitlab', 'gl-carol'), {
    platform: 'gitlab',
    id: '7',
    login: 'carol',
    name: 'Carol',
    avatarUrl: 'https://gitlab.example/7.png',
  });
  assert.deepEqual(await platforms.getUser('gitlab', 'gl-dave'), { platform: 'gitlab', id: '8', login: 'dave', name: null, avatarUrl: null });
});

test('maps a rejected token to 401', async () => {
  await assert.rejects(platforms.getUser('github', 'nope'), (err) => err.status === 401);
});

test('lists only orgs the user owns, plus their own account', async () => {
  const alice = { id: '1001', login: 'alice' };
  assert.deepEqual(
    (await platforms.listOwnedOrgs('github', 'gh-alice', alice)).map((o) => o.name),
    ['alice', 'acme', 'no-app']
  );
  const dave = { id: '8', login: 'dave' };
  assert.deepEqual((await platforms.listOwnedOrgs('gitlab', 'gl-dave', dave)).map((o) => o.name), ['dave']);
});

test('checks ownership live: admins and owners pass, members and strangers do not', async () => {
  const alice = { id: '1001', login: 'alice' };
  const bob = { id: '1002', login: 'bob' };
  assert.equal(await platforms.isOwner('github', 'gh-alice', alice, 'acme'), true);
  assert.equal(await platforms.isOwner('github', 'gh-alice', alice, 'beta'), false);
  assert.equal(await platforms.isOwner('github', 'gh-bob', bob, 'acme'), false);
  assert.equal(await platforms.isOwner('github', 'gh-bob', bob, 'unknown'), false);
  assert.equal(await platforms.isOwner('github', 'gh-bob', bob, 'BOB'), true);
  assert.equal(await platforms.isOwner('gitlab', 'gl-carol', { id: '7', login: 'carol' }, 'grp'), true);
  assert.equal(await platforms.isOwner('gitlab', 'gl-dave', { id: '8', login: 'dave' }, 'grp'), false);
  // An ID that isn't a plain number never reaches the URL.
  assert.equal(await platforms.isOwner('gitlab', 'gl-carol', { id: '7/../../users', login: 'carol' }, 'grp'), false);
});

test('finds the GitHub App installation for an org or user, or null', async () => {
  assert.equal(await platforms.findGithubInstallation('acme', 'org'), '555');
  assert.equal(await platforms.findGithubInstallation('alice', 'user'), '777');
  assert.equal(await platforms.findGithubInstallation('no-app', 'org'), null);
});
