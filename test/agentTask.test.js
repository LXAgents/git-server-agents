// processTask end to end with the platform, whitelist, key and model calls stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = require('../src/services/githubService');
const gitlab = require('../src/services/gitlabService');
const whitelist = require('../src/services/whitelistService');
const keys = require('../src/services/keyService');
const openRouter = require('../src/services/openRouterService');
const { processTask } = require('../src/services/agentService');
const { REPLY_MARKER } = require('../src/services/eventService');

const installation = { id: 'inst-row', installationId: '555' };

function githubTask(body, { org = true } = {}) {
  const payload = {
    action: 'created',
    sender: { login: 'alice', id: 1001 },
    installation: { id: 555 },
    repository: { full_name: 'acme/web', default_branch: 'main', owner: { login: 'acme', id: 50, type: org ? 'Organization' : 'User' } },
    ...(org ? { organization: { login: 'acme' } } : {}),
    issue: { number: 3, title: 'Bug', body: 'It breaks' },
    comment: { id: 900, body, user: { login: 'alice', type: 'User' } },
  };
  return { id: 't1', platform: 'github', event: 'issue_comment', payload: JSON.stringify(payload) };
}

function stubAll(t, { member = true, history = [] } = {}) {
  const calls = { keys: [], posted: [], members: [], complete: [] };
  t.mock.method(whitelist, 'verify', async () => ({ allowed: true, installation, account: {} }));
  t.mock.method(github, 'installationToken', async () => 'inst-token');
  t.mock.method(github, 'listIssueComments', async () => history);
  t.mock.method(github, 'isOrgMember', async (org, login) => {
    calls.members.push([org, login]);
    return member;
  });
  t.mock.method(github, 'getRepoTree', async () => ({ paths: ['src/app.js'], truncated: false }));
  t.mock.method(github, 'postComment', async (repo, number, body) => calls.posted.push({ repo, number, body }));
  t.mock.method(keys, 'getProviderKeys', async (_name, account, inst) => {
    calls.keys.push({ account, inst });
    return { provider: { url: 'https://or.test' }, keys: [{ id: 'k1', owner: 'user', apiKey: 'sk-user' }] };
  });
  t.mock.method(openRouter, 'complete', async (req) => {
    calls.complete.push(req);
    return { content: 'The answer.' };
  });
  t.mock.method(console, 'info', () => {});
  return calls;
}

test('a comment without @vendor/model on line 1 is skipped before any API call', async (t) => {
  const calls = stubAll(t);
  for (const body of ['What files do I have?', '@alice what do you think?', '@openrouter/free']) {
    assert.equal(await processTask(githubTask(body)), 'skipped');
  }
  assert.equal(whitelist.verify.mock.callCount(), 0);
  assert.equal(calls.complete.length, 0);
});

test('an org member gets the org keys as fallback, with history and the issue default branch', async (t) => {
  const history = [
    { id: 899, author: 'alice', body: '@openrouter/free\nFirst question' },
    { id: 900, author: 'alice', body: '@openrouter/free\nWhat files do I have?' },
  ];
  const calls = stubAll(t, { member: true, history });
  assert.equal(await processTask(githubTask('@openrouter/free\nWhat files do I have?')), 'success');
  assert.deepEqual(calls.members, [['acme', 'alice']]);
  assert.equal(calls.keys[0].inst, installation);
  const { messages, model, apiKey } = calls.complete[0];
  assert.equal(model, 'openrouter/free');
  assert.equal(apiKey, 'sk-user');
  assert.deepEqual(
    messages.slice(1).map((m) => [m.role, m.content]),
    [
      ['user', '@alice: First question'],
      ['user', '@alice: What files do I have?'],
    ]
  );
  assert.equal(github.getRepoTree.mock.callCount(), 0);
  assert.match(calls.posted[0].body, new RegExp(`The answer\\.\\n\\n<sub>Model: \`openrouter/free\`</sub>\\n${REPLY_MARKER}`));
});

test('a user who is not an org member never falls back to org keys', async (t) => {
  const calls = stubAll(t, { member: false });
  assert.equal(await processTask(githubTask('@openrouter/free\nhi')), 'success');
  assert.equal(calls.keys[0].inst, null);
});

test('a failed membership check counts as not a member', async (t) => {
  const calls = stubAll(t);
  t.mock.method(github, 'isOrgMember', async () => {
    throw new Error('403 Resource not accessible by integration');
  });
  t.mock.method(console, 'warn', () => {});
  await processTask(githubTask('@openrouter/free\nhi'));
  assert.equal(calls.keys[0].inst, null);
});

test('on a personal account only its owner counts as a member', async (t) => {
  const calls = stubAll(t);
  await processTask(githubTask('@openrouter/free\nhi', { org: false }));
  assert.equal(calls.keys[0].inst, null);
  assert.equal(calls.members.length, 0);
});

test('with no user key and no membership the task fails with a clear reason', async (t) => {
  stubAll(t, { member: false });
  t.mock.method(keys, 'getProviderKeys', async () => ({ provider: {}, keys: [] }));
  await assert.rejects(processTask(githubTask('@openrouter/free\nhi')), /org keys need membership of acme/);
});

test('a GitLab MR reads notes, the diff and files at the MR head commit', async (t) => {
  stubAll(t);
  t.mock.method(gitlab, 'listNotes', async () => [{ id: 1, author: 'agent', body: `Earlier answer\n${REPLY_MARKER}` }]);
  t.mock.method(gitlab, 'getMergeRequestDiff', async () => 'diff --git a/x b/x');
  t.mock.method(gitlab, 'groupExists', async () => true);
  t.mock.method(gitlab, 'isGroupMember', async () => true);
  const refs = [];
  t.mock.method(gitlab, 'getRepoTree', async (_p, ref) => {
    refs.push(ref);
    return { paths: [], truncated: false };
  });
  t.mock.method(gitlab, 'postNote', async () => {});
  const replies = [{ content: '', tool_calls: [{ id: 'c', function: { name: 'list_files', arguments: '{}' } }] }, { content: 'Done' }];
  t.mock.method(openRouter, 'complete', async () => replies.shift());
  const payload = {
    project: { id: 12, path_with_namespace: 'grp/app', default_branch: 'main' },
    user: { id: 7, username: 'carol' },
    object_attributes: { id: 5, note: '@openrouter/free\nList files', noteable_type: 'MergeRequest', action: 'create' },
    merge_request: { iid: 4, title: 'MR', last_commit: { id: 'headsha' } },
  };
  assert.equal(await processTask({ id: 't2', platform: 'gitlab', event: 'note', payload: JSON.stringify(payload) }), 'success');
  assert.deepEqual(refs, ['headsha']);
  assert.deepEqual(gitlab.isGroupMember.mock.calls[0].arguments, ['grp', '7']);
  assert.deepEqual(keys.getProviderKeys.mock.calls[0].arguments[2], installation);
});
