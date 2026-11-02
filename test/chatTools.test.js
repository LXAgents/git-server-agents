const test = require('node:test');
const assert = require('node:assert/strict');
const { roomTools, systemPrompt } = require('../src/services/chat/chatAgent');
const { buildToolGuide } = require('../src/services/agent/prompt');

// GitLab needs no installation token, so the tools are built without any platform call.
const user = { platform: 'gitlab', id: '7', login: 'carol' };
const room = (level, kind = 'repo') => ({
  kind,
  room: `${kind}:r1`,
  name: 'acme/web',
  level,
  defaultBranch: kind === 'repo' ? 'main' : null,
  repository: kind === 'repo' ? { id: 'r1', fullName: 'acme/web', externalId: '42' } : null,
  installation: { id: 'i1', orgName: 'acme' },
});
const choice = { account: { type: 'gitlab', id: '7' }, orgMember: false };
const send = { live: () => {} };
const names = (tools) => tools.repo.tools.map((t) => t.function.name);

test('writers in a repository room get the issue and merge request tools', async () => {
  const tools = await roomTools(room('write'), user, choice, send, 'Create new Issue with title "Set up Project"');
  for (const name of ['list_files', 'read_file', 'create_issue', 'close_issue', 'reopen_issue', 'create_pull_request', 'close_pull_request', 'reopen_pull_request']) {
    assert.ok(names(tools).includes(name), name);
  }
  assert.equal(tools.guide.manage, true);
  assert.match(buildToolGuide({ rounds: 3, ...tools.guide }), /create_issue, close_issue and reopen_issue/);
  // There is no "this" issue in a room: closing one needs its number.
  assert.match(await tools.repo.run('close_issue', '{}'), /give the issue "number"/);
});

test('readers get read tools only, and the prompt says why', async () => {
  const tools = await roomTools(room('read'), user, choice, send, 'Create an issue');
  assert.deepEqual(names(tools), ['list_files', 'read_file']);
  assert.equal(tools.guide.manage, false);
  assert.match(await tools.repo.run('create_issue', '{"title":"x"}'), /unknown tool create_issue/);
  assert.match(systemPrompt(room('read'), user), /can only read acme\/web/);
  assert.doesNotMatch(systemPrompt(room('write'), user), /can only read/);
});

test('issues and merge requests the message mentions can be read', async () => {
  const tools = await roomTools(room('read'), user, choice, send, 'What is left in #3 and !4?');
  assert.ok(names(tools).includes('read_issue'));
  assert.ok(names(tools).includes('read_pull_request'));
  assert.deepEqual(tools.guide.readTools.sort(), ['list_commits', 'read_commit', 'read_issue', 'read_pull_request']);
});

test('rooms without a repository have no tools, and the prompt says where to ask', async () => {
  const tools = await roomTools(room('member', 'org'), user, choice, send, 'Create an issue');
  assert.equal(tools.repo, null);
  assert.match(systemPrompt(room('member', 'org'), user), /no repository/);
});
