// processTask end to end with the platform, whitelist, key and model calls stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = require('../src/services/platforms/githubService');
const gitlab = require('../src/services/platforms/gitlabService');
const whitelist = require('../src/services/whitelistService');
const keys = require('../src/services/keyService');
const openRouter = require('../src/services/ai/openRouterService');
const anthropic = require('../src/services/ai/anthropicService');
const models = require('../src/services/ai/modelService');
const repoStore = require('../src/services/repoStore');
const { processTask } = require('../src/services/agentService');
const { REPLY_MARKER, ERROR_MARKER } = require('../src/services/eventService');

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

function stubAll(t, { member = true, history = [], repository = null, collaborator = false, stored = 'openrouter/free', storedProvider = 'openrouter' } = {}) {
  const calls = { keys: [], posted: [], members: [], complete: [], reactions: [] };
  t.mock.method(github, 'addReaction', async (repo, id, opts) => calls.reactions.push({ repo, id, ...opts }));
  t.mock.method(gitlab, 'awardEmoji', async (projectId, kind, iid, noteId) => calls.reactions.push({ projectId, kind, iid, noteId }));
  t.mock.method(console, 'log', () => {});
  t.mock.method(repoStore, 'findForEvent', async () => repository);
  t.mock.method(models, 'resolveModel', async () => ({ provider: storedProvider, model: stored, source: 'user' }));
  t.mock.method(github, 'isCollaborator', async () => collaborator);
  t.mock.method(whitelist, 'verify', async () => ({ allowed: true, installation, account: {} }));
  t.mock.method(github, 'installationToken', async () => 'inst-token');
  t.mock.method(github, 'listIssueComments', async () => history);
  t.mock.method(github, 'isOrgMember', async (org, login) => {
    calls.members.push([org, login]);
    return member;
  });
  t.mock.method(github, 'getRepoTree', async () => ({ paths: ['src/app.js'], truncated: false }));
  t.mock.method(github, 'postComment', async (repo, number, body) => calls.posted.push({ repo, number, body }));
  t.mock.method(keys, 'getProviderKeys', async (_name, account, inst, repo) => {
    calls.keys.push({ account, inst, repo });
    return { provider: { url: 'https://or.test' }, keys: [{ id: 'k1', owner: 'user', apiKey: 'sk-user' }] };
  });
  t.mock.method(openRouter, 'complete', async (req) => {
    calls.complete.push(req);
    return { content: 'The answer.', cost: 0.000123 };
  });
  t.mock.method(console, 'info', () => {});
  return calls;
}

test('a comment without @lxagents or @vendor/model on line 1 is skipped before any API call', async (t) => {
  const calls = stubAll(t);
  for (const body of ['What files do I have?', '@alice what do you think?', 'hi @openrouter/free']) {
    assert.equal(await processTask(githubTask(body)), 'skipped');
  }
  assert.equal(whitelist.verify.mock.callCount(), 0);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.posted.length, 0);
});

test('a trigger with no question gets a NO_QUESTION reply instead of silence', async (t) => {
  const calls = stubAll(t);
  for (const body of ['@openrouter/free', '@lxagents']) {
    await assert.rejects(processTask(githubTask(body)), /asks nothing/);
  }
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.posted.length, 2);
  assert.match(calls.posted[0].body, /`NO_QUESTION`/);
  assert.match(calls.posted[0].body, new RegExp(`${REPLY_MARKER}\n${ERROR_MARKER}$`));
});

test('in an org nobody imported the agent stays silent', async (t) => {
  const calls = stubAll(t);
  t.mock.method(whitelist, 'verify', async () => ({ allowed: false, reason: 'org acme is not imported' }));
  await assert.rejects(processTask(githubTask('@openrouter/free\nhi')), /not imported/);
  assert.equal(calls.posted.length, 0);
  assert.equal(github.installationToken.mock.callCount(), 0);
});

test('an OpenRouter failure is answered with its code, status, retry advice and the keys tried', async (t) => {
  const calls = stubAll(t);
  t.mock.method(keys, 'getProviderKeys', async () => ({
    provider: {},
    keys: [
      { id: 'k1', owner: 'repo', apiKey: 'sk-repo' },
      { id: 'k2', owner: 'user', apiKey: 'sk-user' },
    ],
  }));
  t.mock.method(openRouter, 'complete', async () => {
    const err = new Error('Request failed with status code 402');
    err.source = 'openrouter';
    err.response = { status: 402, data: { error: { code: 402, message: 'Insufficient credits' } }, headers: {} };
    throw err;
  });
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(processTask(githubTask('@openrouter/free\nhi')), /402/);
  const { body } = calls.posted[0];
  assert.match(body, /`INSUFFICIENT_CREDITS` · HTTP 402/);
  assert.match(body, /`Insufficient credits`/);
  assert.match(body, /Retrying will not help/);
  assert.match(body, /repo key \(402\), user key \(402\)/);
  assert.match(body, /Model: `openrouter\/free` · Task: `t1`/);
  assert.doesNotMatch(body, /sk-repo|sk-user/);
});

test('no usable key is answered with NO_API_KEY', async (t) => {
  const calls = stubAll(t, { member: false });
  t.mock.method(keys, 'getProviderKeys', async () => ({ provider: {}, keys: [] }));
  await assert.rejects(processTask(githubTask('@openrouter/free\nhi')));
  assert.match(calls.posted[0].body, /`NO_API_KEY`/);
});

test('a failed error reply is logged and the task still fails with the original error', async (t) => {
  stubAll(t);
  t.mock.method(github, 'postComment', async () => {
    throw new Error('403 Resource not accessible');
  });
  const logged = [];
  t.mock.method(console, 'error', (line) => logged.push(line));
  await assert.rejects(processTask(githubTask('@lxagents')), /asks nothing/);
  assert.match(logged[0], /could not post the error reply/);
});

test('error replies stay out of the conversation history', async (t) => {
  const history = [
    { id: 898, author: 'alice', body: '@openrouter/free\nFirst' },
    { id: 899, author: 'agent', body: `⚠️ **Rate limit reached**\n${REPLY_MARKER}\n${ERROR_MARKER}` },
  ];
  const calls = stubAll(t, { history });
  await processTask(githubTask('@openrouter/free\nAgain'));
  assert.deepEqual(
    calls.complete[0].messages.slice(1).map((m) => m.role),
    ['user', 'user']
  );
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
  assert.match(calls.posted[0].body, new RegExp(`The answer\\.\\n\\n<sub>Model: \`openrouter/free\`</sub>\\n<sub>Provider: \`OpenRouter\`</sub>\\n<sub>Cost: \`0.000123 USD\`</sub>\\n<sub>Loop: \`3\`</sub>\\n<sub>User: \`@alice\`</sub>\\n${REPLY_MARKER}`));
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

test('@lxagents uses the stored model, and the footer names it', async (t) => {
  const calls = stubAll(t, { stored: 'anthropic/claude-x' });
  assert.equal(await processTask(githubTask('@lxagents what changed?')), 'success');
  assert.equal(calls.complete[0].model, 'anthropic/claude-x');
  assert.equal(models.resolveModel.mock.calls[0].arguments[0].account.id, '1001');
  assert.match(calls.posted[0].body, /Model: `anthropic\/claude-x`/);
});

test('@lxagents dispatches to the stored provider with that provider\'s keys', async (t) => {
  const calls = stubAll(t, { stored: 'claude-opus-5-5', storedProvider: 'anthropic' });
  t.mock.method(anthropic, 'complete', async (req) => {
    calls.complete.push(req);
    return { content: 'From Claude.', cost: null };
  });
  assert.equal(await processTask(githubTask('@lxagents what changed?')), 'success');
  assert.equal(keys.getProviderKeys.mock.calls[0].arguments[0], 'anthropic');
  assert.equal(calls.complete[0].model, 'claude-opus-5-5');
  assert.equal(calls.complete[0].apiKey, 'sk-user');
  const { body } = calls.posted[0];
  assert.match(body, /Model: `claude-opus-5-5`<\/sub>\n<sub>Provider: `Anthropic`<\/sub>\n<sub>Cost: `unknown`/);
});

test('strict BYOK: no key for the stored provider means no model call and a NO_API_KEY reply naming it', async (t) => {
  const calls = stubAll(t, { stored: 'deepseek-chat', storedProvider: 'deepseek' });
  t.mock.method(keys, 'getProviderKeys', async () => ({ provider: {}, keys: [] }));
  await assert.rejects(processTask(githubTask('@lxagents hi')), /No active DeepSeek key/);
  assert.equal(calls.complete.length, 0);
  assert.match(calls.posted[0].body, /`NO_API_KEY`/);
  assert.match(calls.posted[0].body, /DeepSeek key/);
});

test('@vendor/model overrides the stored model', async (t) => {
  const calls = stubAll(t, { stored: 'anthropic/claude-x' });
  await processTask(githubTask('@openai/gpt-5 why?'));
  assert.equal(calls.complete[0].model, 'openai/gpt-5');
  assert.equal(models.resolveModel.mock.callCount(), 0);
});

test('repo keys go to org members without another check', async (t) => {
  const repository = { id: 'repo-row' };
  const calls = stubAll(t, { member: true, repository });
  await processTask(githubTask('@lxagents hi'));
  assert.equal(calls.keys[0].repo, repository);
  assert.equal(github.isCollaborator.mock.callCount(), 0);
});

test('repo keys go to a collaborator who is not an org member, but org keys do not', async (t) => {
  const repository = { id: 'repo-row' };
  const calls = stubAll(t, { member: false, collaborator: true, repository });
  await processTask(githubTask('@lxagents hi'));
  assert.deepEqual(github.isCollaborator.mock.calls[0].arguments, ['acme/web', 'alice', 'inst-token']);
  assert.equal(calls.keys[0].repo, repository);
  assert.equal(calls.keys[0].inst, null);
});

test('someone outside the repo and org gets only their own keys', async (t) => {
  const calls = stubAll(t, { member: false, collaborator: false, repository: { id: 'repo-row' } });
  await processTask(githubTask('@lxagents hi'));
  assert.equal(calls.keys[0].repo, null);
  assert.equal(calls.keys[0].inst, null);
});

test('a GitLab project member gets the repo keys', async (t) => {
  const repository = { id: 'repo-row' };
  const calls = stubAll(t, { repository });
  t.mock.method(gitlab, 'listNotes', async () => []);
  t.mock.method(gitlab, 'groupExists', async () => true);
  t.mock.method(gitlab, 'isGroupMember', async () => false);
  t.mock.method(gitlab, 'isProjectMember', async () => true);
  t.mock.method(gitlab, 'getRepoTree', async () => ({ paths: [], truncated: false }));
  t.mock.method(gitlab, 'postNote', async () => {});
  const payload = {
    project: { id: 12, path_with_namespace: 'grp/app', default_branch: 'main' },
    user: { id: 8, username: 'dave' },
    object_attributes: { id: 6, note: '@lxagents\nhi', noteable_type: 'Issue', action: 'create' },
    issue: { iid: 2, title: 'Issue' },
  };
  assert.equal(await processTask({ id: 't3', platform: 'gitlab', event: 'note', payload: JSON.stringify(payload) }), 'success');
  assert.deepEqual(gitlab.isProjectMember.mock.calls[0].arguments, [12, '8']);
  assert.equal(calls.keys[0].repo, repository);
  assert.equal(calls.keys[0].inst, null);
});

test('the comment gets an eyes reaction as soon as the agent picks it up', async (t) => {
  const calls = stubAll(t);
  await processTask(githubTask('@openrouter/free\nhi'));
  assert.deepEqual(calls.reactions, [{ repo: 'acme/web', id: 900, review: false }]);
});

test('a failed reaction does not stop the answer', async (t) => {
  const calls = stubAll(t);
  t.mock.method(github, 'addReaction', async () => {
    throw new Error('403 Resource not accessible');
  });
  t.mock.method(console, 'warn', () => {});
  assert.equal(await processTask(githubTask('@openrouter/free\nhi')), 'success');
  assert.equal(calls.posted.length, 1);
});

test('an answer that runs past TASK_TIMEOUT_MS is cut short with a TIMEOUT reply', async (t) => {
  const config = require('../src/config');
  t.mock.property(config.ai, 'taskTimeoutMs', 30);
  const calls = stubAll(t);
  t.mock.method(openRouter, 'complete', async ({ timeout }) => {
    await new Promise((resolve) => setTimeout(resolve, timeout + 5));
    const err = Object.assign(new Error(`timeout of ${timeout}ms exceeded`), { code: 'ECONNABORTED', source: 'openrouter' });
    throw err;
  });
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(processTask(githubTask('@openrouter/free\nhi')), (err) => err.deadline === 30);
  assert.match(calls.posted[0].body, /`TIMEOUT`/);
  assert.match(calls.posted[0].body, /limit for one comment/);
});

test('the cost line adds up every model call of the answer, in USD', () => {
  const { formatCost } = require('../src/services/agentService');
  assert.equal(formatCost({ cost: 0, complete: true }), '0 USD');
  assert.equal(formatCost({ cost: 0.000123, complete: true }), '0.000123 USD');
  assert.equal(formatCost({ cost: 0.0215, complete: true }), '0.0215 USD');
  assert.equal(formatCost({ cost: 0.0000001, complete: true }), '< 0.000001 USD');
  assert.equal(formatCost({ cost: 0.002, complete: false }), '≥ 0.002 USD');
  assert.equal(formatCost({ cost: 0, complete: false }), 'unknown');
});
