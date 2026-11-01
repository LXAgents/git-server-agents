// The GitHub and GitLab REST calls behind chat history, file reading and org membership,
// against a local fake API.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const seen = [];
const app = express();
app.use((req, _res, next) => {
  seen.push({ path: req.path, query: req.query, auth: req.get('authorization'), privateToken: req.get('private-token'), accept: req.get('accept') });
  next();
});

// GitHub: 130 comments over two pages.
const ghComments = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, body: `c${i + 1}`, user: { login: i % 2 ? 'bot[bot]' : 'alice', type: i % 2 ? 'Bot' : 'User' } }));
app.get('/gh/repos/acme/web/issues/7/comments', (req, res) => {
  const page = Number(req.query.page);
  res.json(ghComments.slice((page - 1) * 100, page * 100));
});
app.get('/gh/repos/acme/web/git/trees/:ref', (req, res) =>
  res.json({ truncated: false, tree: [{ path: 'src', type: 'tree' }, { path: 'src/a.js', type: 'blob' }, { path: 'README.md', type: 'blob' }] })
);
app.get('/gh/repos/acme/web/contents/*path', (req, res) => {
  const path = [].concat(req.params.path).join('/');
  if (path === 'src/a b.js' && req.query.ref === 'abc') return res.type('text/plain').send('A at abc');
  return res.status(404).json({ message: 'Not Found' });
});
app.get('/gh/orgs/acme/members/:login', (req, res) => {
  if (req.params.login === 'alice') return res.status(204).end();
  if (req.params.login === 'carol') return res.redirect(302, '/gh/orgs/acme/public_members/carol');
  return res.status(404).json({ message: 'Not Found' });
});

// GitLab.
app.get('/gl/projects/12/merge_requests/4/notes', (req, res) =>
  res.json([
    { id: 3, body: 'newest', system: false, author: { username: 'carol' } },
    { id: 2, body: 'added 1 commit', system: true, author: { username: 'carol' } },
    { id: 1, body: 'oldest', system: false, author: { username: 'dave', bot: false } },
  ])
);
app.get('/gl/projects/12/repository/tree', (req, res) => {
  const page = Number(req.query.page);
  const all = Array.from({ length: 150 }, (_, i) => ({ path: `f${i}.js`, type: 'blob' }));
  res.json(all.slice((page - 1) * 100, page * 100));
});
app.get('/gl/projects/12/repository/files/:path/raw', (req, res) =>
  req.params.path === 'src/a.js' && req.query.ref === 'sha1' ? res.type('text/plain').send('GL sha1') : res.status(404).json({ message: '404 File Not Found' })
);
app.get('/gl/groups/grp', (_req, res) => res.json({ id: 99 }));
app.get('/gl/groups/:group', (_req, res) => res.status(404).json({ message: '404 Group Not Found' }));
app.get('/gl/groups/grp/members/all/:id', (req, res) =>
  req.params.id === '7' ? res.json({ id: 7, access_level: 10, state: 'active' }) : res.status(404).json({ message: '404 Not found' })
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

test('GitHub: pages through comments and keeps the last 30, oldest first', async () => {
  const comments = await github.listIssueComments('acme/web', 7, 'inst-token');
  assert.equal(comments.length, 30);
  assert.deepEqual([comments[0].id, comments.at(-1).id], [101, 130]);
  assert.deepEqual(comments[1], { id: 102, author: 'bot[bot]', isBot: true, body: 'c102' });
  assert.equal(seen.find((s) => s.path.endsWith('/comments')).auth, 'Bearer inst-token');
});

test('GitHub: reads the tree and raw files at a ref, and checks org membership', async () => {
  assert.deepEqual(await github.getRepoTree('acme/web', 'abc', 't'), { paths: ['src/a.js', 'README.md'], truncated: false });
  assert.equal(await github.getFileContent('acme/web', 'src/a b.js', 'abc', 't'), 'A at abc');
  assert.equal(seen.find((s) => s.path.includes('/contents/')).accept, 'application/vnd.github.raw+json');
  assert.equal(await github.getFileContent('acme/web', 'missing.js', 'abc', 't'), null);
  assert.equal(await github.isOrgMember('acme', 'alice', 't'), true);
  assert.equal(await github.isOrgMember('acme', 'carol', 't'), false);
  assert.equal(await github.isOrgMember('acme', 'mallory', 't'), false);
});

test('GitLab: newest notes come back oldest first without system notes', async () => {
  const notes = await gitlab.listNotes(12, 'pull_request', 4);
  assert.deepEqual(notes.map((n) => n.body), ['oldest', 'newest']);
  const call = seen.find((s) => s.path.endsWith('/notes'));
  assert.deepEqual([call.query.sort, call.query.per_page, call.privateToken], ['desc', '30', 'bot-token']);
});

test('GitLab: pages the tree, reads raw files, and checks group membership', async () => {
  const tree = await gitlab.getRepoTree(12, 'main');
  assert.equal(tree.paths.length, 150);
  assert.equal((await gitlab.getRepoTree(12, 'main', { maxPages: 1 })).truncated, true);
  assert.equal(await gitlab.getFileContent(12, 'src/a.js', 'sha1'), 'GL sha1');
  assert.ok(seen.some((s) => s.path === '/gl/projects/12/repository/files/src%2Fa.js/raw' || s.path === '/gl/projects/12/repository/files/src/a.js/raw'));
  assert.equal(await gitlab.getFileContent(12, 'nope', 'sha1'), null);
  assert.equal(await gitlab.groupExists('grp'), true);
  assert.equal(await gitlab.groupExists('carol'), false);
  assert.equal(await gitlab.isGroupMember('grp', 7), true);
  assert.equal(await gitlab.isGroupMember('grp', 8), false);
});
