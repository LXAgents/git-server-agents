const test = require('node:test');
const assert = require('node:assert/strict');
const { githubIdentity, gitlabIdentity } = require('../src/services/identityService');

test('reads the GitHub sender and organization', () => {
  const identity = githubIdentity({
    sender: { login: 'alice', id: 1001 },
    organization: { login: 'acme' },
    installation: { id: 555, account: { login: 'ignored' } },
  });
  assert.deepEqual(identity, { triggerUser: 'alice', triggerUserId: '1001', targetOrg: 'acme', installationId: '555' });
});

test('falls back to the installation account when there is no organization', () => {
  const identity = githubIdentity({ sender: { login: 'bob', id: 2 }, installation: { id: 9, account: { login: 'bob' } } });
  assert.equal(identity.targetOrg, 'bob');
});

test('uses the top-level GitLab group as the org', () => {
  const identity = gitlabIdentity({ user: { id: 7, username: 'carol' }, project: { path_with_namespace: 'grp/sub/proj' } });
  assert.deepEqual(identity, { triggerUser: 'carol', triggerUserId: '7', targetOrg: 'grp', installationId: null });
});

test('returns nulls for an empty payload', () => {
  assert.equal(githubIdentity({}).triggerUserId, null);
  assert.equal(gitlabIdentity({}).targetOrg, null);
});
