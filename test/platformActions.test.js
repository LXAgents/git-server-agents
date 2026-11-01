// The GitHub and GitLab REST calls behind the agent's issue and pull request tools, against a
// local fake API that records each method, path and body.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const seen = [];
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  seen.push({ method: req.method, path: req.path, body: req.body, auth: req.get('authorization'), privateToken: req.get('private-token') });
  next();
});

// GitHub: #3 is an issue, #8 a pull request.
const ghIssue = (number, state, extra = {}) => ({ number, state, html_url: `https://github.com/acme/web/issues/${number}`, ...extra });
app.get('/gh/repos/acme/web/collaborators/:login/permission', (req, res) => {
  const permissions = { alice: 'admin', bob: 'write', carol: 'read' };
  return permissions[req.params.login] ? res.json({ permission: permissions[req.params.login] }) : res.status(404).json({ message: 'Not Found' });
});
app.post('/gh/repos/acme/web/issues', (req, res) => res.status(201).json(ghIssue(11, 'open')));
app.get('/gh/repos/acme/web/issues/:number', (req, res) =>
  res.json(ghIssue(Number(req.params.number), 'open', req.params.number === '8' ? { pull_request: { url: 'x' } } : {}))
);
app.patch('/gh/repos/acme/web/issues/:number', (req, res) => res.json(ghIssue(Number(req.params.number), req.body.state)));

app.post('/gh/repos/acme/web/pulls', (req, res) => res.status(201).json({ number: 21, state: 'open', html_url: 'https://github.com/acme/web/pull/21' }));
app.patch('/gh/repos/acme/web/pulls/:number', (req, res) =>
  res.json({ number: Number(req.params.number), state: req.body.state, merged: false, html_url: `https://github.com/acme/web/pull/${req.params.number}` })
);

// GitLab: project 12; user 8 is a Developer, 9 a blocked Maintainer.
app.get('/gl/projects/12/members/all/:id', (req, res) => {
  const members = { 8: { id: 8, access_level: 30, state: 'active' }, 9: { id: 9, access_level: 40, state: 'blocked' } };
  return members[req.params.id] ? res.json(members[req.params.id]) : res.status(404).json({ message: '404 Not found' });
});
const glIssue = (iid, state) => ({ iid, state, web_url: `https://gitlab.com/grp/app/-/issues/${iid}` });
app.post('/gl/projects/12/issues', (req, res) => res.status(201).json(glIssue(5, 'opened')));
app.put('/gl/projects/12/issues/:iid', (req, res) => res.json(glIssue(Number(req.params.iid), req.body.state_event === 'close' ? 'closed' : 'opened')));

app.post('/gl/projects/12/merge_requests', (req, res) => res.status(201).json({ iid: 4, state: 'opened', web_url: 'https://gitlab.com/grp/app/-/merge_requests/4' }));
app.put('/gl/projects/12/merge_requests/:iid', (req, res) =>
  res.json({ iid: Number(req.params.iid), state: req.body.state_event === 'close' ? 'closed' : 'opened', web_url: 'u' })
);

let server;
let github;
let gitlab;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.GITHUB_API_URL = `${base}/gh`;
  process.env.GITLAB_API_URL = `${base}/gl`;
  process.env.GITLAB_TOKEN = 'bot-token';
  github = require('../src/services/platforms/githubService');
  gitlab = require('../src/services/platforms/gitlabService');
});

test.after(() => server.close());

const last = (method, path) => seen.findLast((s) => s.method === method && s.path === path);

test('GitHub: reads the commenter permission, 404 meaning none', async () => {
  assert.equal(await github.getCollaboratorPermission('acme/web', 'alice', 't'), 'admin');
  assert.equal(await github.getCollaboratorPermission('acme/web', 'carol', 't'), 'read');
  assert.equal(await github.getCollaboratorPermission('acme/web', 'mallory', 't'), 'none');
  assert.equal(last('GET', '/gh/repos/acme/web/collaborators/alice/permission').auth, 'Bearer t');
});

test('GitHub: creates, closes and reopens issues, and refuses a pull request number', async () => {
  assert.deepEqual(await github.createIssue('acme/web', { title: 'T', body: 'B', labels: ['bug'] }, 't'), {
    number: 11,
    url: 'https://github.com/acme/web/issues/11',
    state: 'open',
  });
  assert.deepEqual(last('POST', '/gh/repos/acme/web/issues').body, { title: 'T', body: 'B', labels: ['bug'] });
  assert.equal((await github.setIssueState('acme/web', 3, 'closed', { reason: 'completed' }, 't')).state, 'closed');
  assert.deepEqual(last('PATCH', '/gh/repos/acme/web/issues/3').body, { state: 'closed', state_reason: 'completed' });
  await github.setIssueState('acme/web', 3, 'open', {}, 't');
  assert.deepEqual(last('PATCH', '/gh/repos/acme/web/issues/3').body, { state: 'open' });
  await assert.rejects(github.setIssueState('acme/web', 8, 'closed', {}, 't'), (err) => err.notIssue === true);
  assert.equal(last('PATCH', '/gh/repos/acme/web/issues/8'), undefined);
});

test('GitLab: member access levels, blocked users counting as none', async () => {
  assert.equal(await gitlab.getMemberAccessLevel(12, 8), 30);
  assert.equal(await gitlab.getMemberAccessLevel(12, 9), 0);
  assert.equal(await gitlab.getMemberAccessLevel(12, 99), 0);
  assert.equal(await gitlab.isProjectMember(12, 8), true);
  assert.equal(await gitlab.isProjectMember(12, 99), false);
});

test('GitLab: creates issues and closes or reopens them with state_event', async () => {
  assert.deepEqual(await gitlab.createIssue(12, { title: 'T', body: 'B', labels: ['bug', 'ui'] }), {
    number: 5,
    url: 'https://gitlab.com/grp/app/-/issues/5',
    state: 'open',
  });
  const created = last('POST', '/gl/projects/12/issues');
  assert.deepEqual(created.body, { title: 'T', description: 'B', labels: 'bug,ui' });
  assert.equal(created.privateToken, 'bot-token');
  assert.equal((await gitlab.setIssueState(12, 4, 'closed')).state, 'closed');
  assert.deepEqual(last('PUT', '/gl/projects/12/issues/4').body, { state_event: 'close' });
  await gitlab.setIssueState(12, 4, 'open');
  assert.deepEqual(last('PUT', '/gl/projects/12/issues/4').body, { state_event: 'reopen' });
});

test('GitHub: creates pull requests and closes or reopens them on the pulls endpoint', async () => {
  const fields = { title: 'T', body: 'B', head: 'fix/x', base: 'main', draft: false };
  assert.deepEqual(await github.createPullRequest('acme/web', fields, 't'), { number: 21, url: 'https://github.com/acme/web/pull/21', state: 'open' });
  assert.deepEqual(last('POST', '/gh/repos/acme/web/pulls').body, fields);
  assert.equal((await github.setPullRequestState('acme/web', 8, 'closed', 't')).state, 'closed');
  assert.deepEqual(last('PATCH', '/gh/repos/acme/web/pulls/8').body, { state: 'closed' });
  await github.setPullRequestState('acme/web', 8, 'open', 't');
  assert.deepEqual(last('PATCH', '/gh/repos/acme/web/pulls/8').body, { state: 'open' });
});

test('GitLab: creates merge requests (Draft: prefix) and closes or reopens them', async () => {
  assert.deepEqual(await gitlab.createMergeRequest(12, { title: 'T', body: 'B', head: 'feat/x', base: 'main', draft: true }), {
    number: 4,
    url: 'https://gitlab.com/grp/app/-/merge_requests/4',
    state: 'open',
  });
  assert.deepEqual(last('POST', '/gl/projects/12/merge_requests').body, { title: 'Draft: T', description: 'B', source_branch: 'feat/x', target_branch: 'main' });
  await gitlab.createMergeRequest(12, { title: 'T', body: '', head: 'feat/x', base: 'main' });
  assert.equal(last('POST', '/gl/projects/12/merge_requests').body.title, 'T');
  assert.equal((await gitlab.setMergeRequestState(12, 4, 'closed')).state, 'closed');
  assert.deepEqual(last('PUT', '/gl/projects/12/merge_requests/4').body, { state_event: 'close' });
  assert.equal((await gitlab.setMergeRequestState(12, 4, 'open')).state, 'open');
  assert.deepEqual(last('PUT', '/gl/projects/12/merge_requests/4').body, { state_event: 'reopen' });
});
