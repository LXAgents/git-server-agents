const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const childProcess = require('child_process');

let server;
let cs;
const seen = [];
const codespaces = new Map();

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    seen.push({ method: req.method, path: req.path, auth: req.get('authorization'), body: req.body });
    if (req.get('authorization') !== 'Bearer ghp_good') return res.status(401).json({ message: 'Bad credentials' });
    return next();
  });
  app.post('/repos/:owner/:repo/codespaces', (req, res) => {
    if (req.params.repo === 'nope') return res.status(403).json({ message: 'Codespaces are not enabled' });
    const name = `cs-${codespaces.size + 1}`;
    codespaces.set(name, { polls: 0 });
    return res.status(201).json({ name, state: 'Queued', repository: { full_name: `${req.params.owner}/${req.params.repo}` }, git_status: { ref: req.body.ref || 'main' } });
  });
  app.get('/user/codespaces/:name', (req, res) => {
    const c = codespaces.get(req.params.name);
    if (!c) return res.status(404).json({ message: 'Not Found' });
    c.polls += 1;
    return res.json({ name: req.params.name, state: c.polls >= 2 ? 'Available' : 'Starting' });
  });
  app.delete('/user/codespaces/:name', (req, res) => {
    if (!codespaces.delete(req.params.name)) return res.status(404).json({ message: 'Not Found' });
    return res.sendStatus(202);
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  process.env.GITHUB_API_URL = `http://127.0.0.1:${server.address().port}`;
  cs = require('../src/services/platforms/githubCodespacesService');
});

test.after(() => server.close());

test('creates a codespace on the branch with an idle timeout, and reads its state', async () => {
  const created = await cs.createCodespace('acme/web', 'fix/login', 'ghp_good');
  assert.deepEqual([created.name, created.state, created.repository, created.branch], ['cs-1', 'Queued', 'acme/web', 'fix/login']);
  const post = seen.find((r) => r.method === 'POST');
  assert.deepEqual(post.body, { idle_timeout_minutes: 10, ref: 'fix/login' });
  const ready = await cs.waitUntilAvailable('cs-1', async () => 'ghp_good', { pollMs: 1 });
  assert.equal(ready.state, 'Available');
});

test('maps GitHub refusals to CodespacesError without the token', async () => {
  await assert.rejects(cs.createCodespace('acme/nope', null, 'ghp_good'), (err) => {
    assert.equal(err.source, 'codespaces');
    assert.equal(err.code, 'WORKSPACE_ERROR');
    assert.equal(err.response.status, 403);
    assert.match(err.message, /Codespaces are not enabled/);
    return true;
  });
  await assert.rejects(cs.getCodespaceStatus('cs-1', 'ghp_bad'), (err) => err.response.status === 401 && !err.message.includes('ghp_bad'));
});

test('refuses bad input before calling GitHub', async () => {
  const before = seen.length;
  await assert.rejects(cs.createCodespace('not a repo', null, 'ghp_good'), { code: 'BAD_INPUT' });
  await assert.rejects(cs.createCodespace('acme/web', 'bad..branch', 'ghp_good'), { code: 'BAD_INPUT' });
  await assert.rejects(cs.getCodespaceStatus('../../user', 'ghp_good'), { code: 'BAD_INPUT' });
  assert.equal(seen.length, before);
});

test('times out waiting when the codespace never becomes available', async () => {
  const { name } = await cs.createCodespace('acme/web', null, 'ghp_good');
  codespaces.get(name).polls = -1000;
  await assert.rejects(cs.waitUntilAvailable(name, async () => 'ghp_good', { timeoutMs: 5, pollMs: 10 }), { code: 'WORKSPACE_UNAVAILABLE' });
});

test('deletes a codespace, and a missing one counts as deleted', async () => {
  assert.deepEqual(await cs.deleteCodespace('cs-1', 'ghp_good'), { name: 'cs-1', deleted: true });
  assert.equal((await cs.deleteCodespace('cs-1', 'ghp_good')).alreadyGone, true);
});

test('runs commands through gh codespace ssh with only GH_TOKEN and basics in the environment', async (t) => {
  process.env.ENCRYPTION_KEY = 'secret-that-must-not-leak';
  const calls = [];
  t.mock.method(childProcess, 'execFile', (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    const err = Object.assign(new Error('exit 2'), { code: 2 });
    cb(err, 'out', 'err');
  });
  const result = await cs.executeCommand('cs-2', 'npm test && echo "$HOME"', 'ghp_good');
  assert.deepEqual(result, { stdout: 'out', stderr: 'err', exitCode: 2, timedOut: false });
  assert.equal(calls[0].file, 'gh');
  assert.deepEqual(calls[0].args, ['codespace', 'ssh', '-c', 'cs-2', '--', 'bash', '-lc', 'npm test && echo "$HOME"']);
  assert.equal(calls[0].opts.env.GH_TOKEN, 'ghp_good');
  assert.equal(calls[0].opts.env.ENCRYPTION_KEY, undefined);
  assert.ok(calls[0].opts.timeout > 0);
});

test('says so when gh is not installed', async (t) => {
  t.mock.method(childProcess, 'execFile', (_f, _a, _o, cb) => cb(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })));
  await assert.rejects(cs.executeCommand('cs-2', 'ls', 'ghp_good'), { code: 'WORKSPACE_UNAVAILABLE' });
  await assert.rejects(cs.executeCommand('cs-2', '  ', 'ghp_good'), { code: 'BAD_INPUT' });
});
