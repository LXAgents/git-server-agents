const test = require('node:test');
const assert = require('node:assert/strict');

const codespaces = require('../src/services/platforms/githubCodespacesService');
const { createWorkspaceTools, clipOutput, shellQuote, MAX_OUTPUT_CHARS } = require('../src/services/agent/workspaceTools');
const { createRepoTools } = require('../src/services/agent/repoTools');
const { buildToolGuide } = require('../src/services/agent/prompt');
const { classify } = require('../src/services/agentErrors');
const keeper = require('../src/services/agent/workspaceKeeper');

function key(owner, token) {
  const k = { id: `${owner}-key`, owner, reveals: 0 };
  k.reveal = async () => {
    k.reveals += 1;
    return token;
  };
  return k;
}

function mockCodespaces(t, { refuse = new Set(), stopped = new Set(), gone = new Set(), exec = () => ({ stdout: 'ok', stderr: '', exitCode: 0, timedOut: false }) } = {}) {
  const calls = [];
  t.mock.method(codespaces, 'createCodespace', async (repo, ref, token) => {
    calls.push(['create', repo, ref, token]);
    if (refuse.has(token)) throw new codespaces.CodespacesError('refused', { response: { status: 403, data: {} } });
    return { name: `cs-${calls.length}`, state: 'Queued', branch: ref };
  });
  t.mock.method(codespaces, 'waitUntilAvailable', async (name, getToken, { onState }) => {
    calls.push(['wait', name, await getToken()]);
    onState('Starting');
    return { name, state: 'Available' };
  });
  t.mock.method(codespaces, 'executeCommand', async (name, command, token) => {
    calls.push(['exec', name, command, token]);
    return exec(command);
  });
  t.mock.method(codespaces, 'deleteCodespace', async (name, token) => {
    calls.push(['delete', name, token]);
    return { name, deleted: true };
  });
  t.mock.method(codespaces, 'getCodespaceStatus', async (name, token) => {
    calls.push(['status', name, token]);
    if (gone.has(name)) throw new codespaces.CodespacesError('gone', { response: { status: 404, data: {} } });
    return { name, state: stopped.has(name) ? 'Shutdown' : 'Available' };
  });
  t.mock.method(codespaces, 'startCodespace', async (name, token) => {
    calls.push(['start', name, token]);
    stopped.delete(name);
    return { name, state: 'Starting' };
  });
  t.after(() => keeper.reset());
  return calls;
}

test('create_workspace falls back to the next key when one is refused, and reports progress', async (t) => {
  const calls = mockCodespaces(t, { refuse: new Set(['repo-token']) });
  const progress = [];
  const keys = [key('repo', 'repo-token'), key('org', 'org-token'), key('user', 'user-token')];
  const ws = createWorkspaceTools({ repo: 'acme/web', defaultBranch: 'main', branch: 'feat/x', keys, onProgress: (p) => progress.push(p) });
  const out = JSON.parse(await ws.handlers.create_workspace({}));
  assert.deepEqual(out, { workspaceId: 'cs-2', state: 'Available', repository: 'acme/web', branch: 'feat/x' });
  assert.deepEqual(calls.slice(0, 3), [
    ['create', 'acme/web', 'feat/x', 'repo-token'],
    ['create', 'acme/web', 'feat/x', 'org-token'],
    ['wait', 'cs-2', 'org-token'],
  ]);
  assert.equal(keys[2].reveals, 0);
  assert.deepEqual(progress[0], { tool: 'create_workspace', status: 'Creating GitHub Codespace...' });
  assert.ok(progress.some((p) => p.status.includes('ready')));
});

test('exec_command only reaches workspaces this answer created, and caps the output', async (t) => {
  const calls = mockCodespaces(t, { exec: () => ({ stdout: 'x'.repeat(50_000), stderr: 'boom', exitCode: 3, timedOut: false }) });
  const ws = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')] });
  const { workspaceId } = JSON.parse(await ws.handlers.create_workspace({ branch: 'dev' }));
  const result = JSON.parse(await ws.handlers.exec_command({ workspaceId, command: 'npm test' }));
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr, 'boom');
  assert.ok(result.stdout.length + result.stderr.length <= MAX_OUTPUT_CHARS);
  assert.match(result.stdout, /^\[50000 characters, only the last ones shown\]/);

  assert.match(await ws.handlers.exec_command({ workspaceId: 'someone-elses', command: 'ls' }), /^Error: exec_command: someone-elses is not a workspace of this conversation/);
  assert.match(await ws.handlers.exec_command({ workspaceId }), /command is required/);
  assert.equal(calls.filter((c) => c[0] === 'exec').length, 1);
});

test('commit_workspace pushes a quoted branch and refuses the default branch', async (t) => {
  const calls = mockCodespaces(t);
  const ws = createWorkspaceTools({ repo: 'acme/web', defaultBranch: 'main', keys: [key('user', 'u')] });
  const { workspaceId } = JSON.parse(await ws.handlers.create_workspace({}));
  const out = JSON.parse(await ws.handlers.commit_workspace({ workspaceId, branchName: 'fix/login', commitMessage: "fix: don't loop" }));
  assert.equal(out.pushed, true);
  const script = calls.find((c) => c[0] === 'exec')[2];
  assert.match(script, /git checkout -B 'fix\/login'/);
  assert.match(script, /git commit -m 'fix: don'\\''t loop'/);
  assert.match(script, /git push -u origin 'fix\/login'/);

  assert.match(await ws.handlers.commit_workspace({ workspaceId, branchName: 'main', commitMessage: 'x' }), /refusing to push to the default branch/);
  assert.match(await ws.handlers.commit_workspace({ workspaceId, branchName: 'a b', commitMessage: 'x' }), /not a valid branch name/);
});

test('without a conversation, cleanup deletes every workspace left open, and delete_workspace removes one', async (t) => {
  const calls = mockCodespaces(t);
  const ws = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')] });
  const a = JSON.parse(await ws.handlers.create_workspace({ branch: 'one' })).workspaceId;
  const b = JSON.parse(await ws.handlers.create_workspace({ branch: 'two' })).workspaceId;
  assert.match(await ws.handlers.create_workspace({ branch: 'three' }), /already has 2 workspaces/);
  assert.deepEqual(JSON.parse(await ws.handlers.delete_workspace({ workspaceId: a })), { workspaceId: a, deleted: true });
  assert.deepEqual(ws.openWorkspaces(), [b]);
  await ws.cleanup();
  assert.deepEqual(ws.openWorkspaces(), []);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'delete').map((c) => c[1]),
    [a, b]
  );
});

test('repo tools offer the workspace tools only when given, and cleanup is not a tool', async (t) => {
  mockCodespaces(t);
  const ws = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')] });
  const source = { platform: 'github', repo: 'acme/web', ref: 'main', token: 't' };
  const names = (tools) => tools.tools.map((x) => x.function.name);
  assert.ok(!names(createRepoTools(source)).includes('create_workspace'));
  const withWs = createRepoTools(source, { workspace: ws.handlers });
  assert.deepEqual(names(withWs).slice(-4), ['create_workspace', 'exec_command', 'commit_workspace', 'delete_workspace']);
  assert.equal(await withWs.run('cleanup', '{}'), 'Error: unknown tool cleanup.');
  assert.match(buildToolGuide({ rounds: 3, workspace: true }), /create_workspace starts a GitHub Codespace/);
  assert.doesNotMatch(buildToolGuide({ rounds: 3 }), /create_workspace/);
});

test('helpers: shell quoting and output clipping', () => {
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  const { stdout, stderr } = clipOutput({ stdout: 'a'.repeat(20), stderr: 'b'.repeat(20) }, 20);
  assert.ok(stdout.length + stderr.length <= 20);
  assert.deepEqual(clipOutput({ stdout: 'short', stderr: '' }, 20), { stdout: 'short', stderr: '' });
});

test('Codespaces failures map to the workspace error codes', () => {
  const refused = new codespaces.CodespacesError('GitHub could not create a codespace (HTTP 403: off)', { response: { status: 403 } });
  assert.deepEqual([classify(refused).code, classify(refused).status], ['WORKSPACE_ERROR', 403]);
  assert.equal(classify(new codespaces.CodespacesError('no gh', { code: 'WORKSPACE_UNAVAILABLE' })).code, 'WORKSPACE_UNAVAILABLE');
  assert.equal(classify(Object.assign(new Error('need a token'), { code: 'NO_WORKSPACE_KEY', status: 401 })).code, 'NO_WORKSPACE_KEY');
});

test('the codespace used last is kept for the next message of the same conversation and reused', async (t) => {
  const calls = mockCodespaces(t);
  const scope = 'chat:repo:r1:s1';
  const first = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')], scope });
  assert.equal(first.reused, null);
  const { workspaceId } = JSON.parse(await first.handlers.create_workspace({}));
  // A second create_workspace in the same answer reuses it too.
  assert.equal(JSON.parse(await first.handlers.create_workspace({})).reused, true);
  await first.cleanup();
  assert.equal(calls.filter((c) => c[0] === 'delete').length, 0);
  assert.equal(keeper.size(), 1);

  const progress = [];
  const next = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')], scope, onProgress: (p) => progress.push(p) });
  assert.equal(next.reused, workspaceId);
  assert.equal(keeper.size(), 0);
  const created = JSON.parse(await next.handlers.create_workspace({}));
  assert.deepEqual([created.workspaceId, created.reused], [workspaceId, true]);
  assert.equal(JSON.parse(await next.handlers.exec_command({ workspaceId, command: 'npm init -y' })).exitCode, 0);
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
  // Checked once per answer, not before every command.
  assert.equal(calls.filter((c) => c[0] === 'status').length, 1);
  assert.ok(progress.some((p) => p.status === `Reusing codespace ${workspaceId}`));
  await next.cleanup();
  assert.equal(keeper.size(), 1);
});

test('a kept codespace that GitHub stopped is started again; one that is gone is forgotten', async (t) => {
  const stopped = new Set(['cs-1']);
  const gone = new Set();
  const calls = mockCodespaces(t, { stopped, gone });
  const scope = 'github:acme/web#7';
  const a = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')], scope });
  await a.handlers.create_workspace({});
  await a.cleanup();

  const b = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')], scope });
  assert.equal(JSON.parse(await b.handlers.exec_command({ workspaceId: 'cs-1', command: 'ls' })).exitCode, 0);
  assert.deepEqual(calls.filter((c) => ['status', 'start', 'wait', 'exec'].includes(c[0])).map((c) => c[0]).slice(-4), ['status', 'start', 'wait', 'exec']);
  await b.cleanup();

  gone.add('cs-1');
  const c = createWorkspaceTools({ repo: 'acme/web', keys: [key('user', 'u')], scope });
  assert.match(await c.handlers.exec_command({ workspaceId: 'cs-1', command: 'ls' }), /no longer exists; create a new workspace/);
  assert.deepEqual(c.openWorkspaces(), []);
  const fresh = JSON.parse(await c.handlers.create_workspace({}));
  assert.notEqual(fresh.workspaceId, 'cs-1');
  assert.equal(fresh.reused, undefined);
});

test('only the same repository and someone who may use the same key reuse a kept codespace', async (t) => {
  const calls = mockCodespaces(t);
  const scope = 'chat:repo:r1:s1';
  const a = createWorkspaceTools({ repo: 'acme/web', keys: [key('alice', 'a')], scope });
  await a.handlers.create_workspace({});
  await a.cleanup();
  assert.equal(createWorkspaceTools({ repo: 'acme/web', keys: [key('bob', 'b')], scope }).reused, null);
  assert.equal(createWorkspaceTools({ repo: 'acme/other', keys: [key('alice', 'a')], scope }).reused, null);
  assert.equal(keeper.size(), 1);
  assert.equal(createWorkspaceTools({ repo: 'acme/web', keys: [key('bob', 'b'), key('alice', 'a')], scope }).reused, 'cs-1');
  assert.equal(calls.filter((c) => c[0] === 'delete').length, 0);
});

test('keeping is off with WORKSPACE_KEEP_MINUTES=0, a scope keeps one codespace, and expired ones are deleted', async (t) => {
  const calls = mockCodespaces(t);
  const k = key('user', 'u');
  assert.equal(await keeper.keep('s', { name: 'cs-a', repo: 'acme/web', key: k }, { minutes: 0 }), false);
  assert.equal(await keeper.keep(null, { name: 'cs-a', repo: 'acme/web', key: k }), false);
  assert.equal(await keeper.keep('s', { name: 'cs-a', repo: 'acme/web', key: k }, { minutes: 60 }), true);
  assert.equal(await keeper.keep('s', { name: 'cs-b', repo: 'acme/web', key: k }, { minutes: 60 }), true);
  assert.deepEqual(calls.filter((c) => c[0] === 'delete').map((c) => c[1]), ['cs-a']);
  await keeper.sweep(Date.now() + 59 * 60_000);
  assert.equal(keeper.size(), 1);
  await keeper.sweep(Date.now() + 61 * 60_000);
  assert.equal(keeper.size(), 0);
  assert.deepEqual(calls.filter((c) => c[0] === 'delete').map((c) => c[1]), ['cs-a', 'cs-b']);
});

test('the tool guide names the codespace kept from the last message', () => {
  const guide = buildToolGuide({ rounds: 3, workspace: true, reusedWorkspace: 'cs-9' });
  assert.match(guide, /cs-9 from the last message is still open/);
  assert.match(guide, /stays open for the next message/);
  assert.doesNotMatch(buildToolGuide({ rounds: 3, workspace: true }), /still open/);
});
