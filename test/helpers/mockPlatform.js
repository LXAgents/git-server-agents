// A fake GitHub and GitLab for tests. The APIs are served under /gh and /gl, and the OAuth
// web endpoints under /ghweb and /glweb.
const crypto = require('crypto');
const express = require('express');

const githubUsers = {
  'gh-alice': { id: 1001, login: 'alice' },
  'gh-bob': { id: 1002, login: 'bob' },
  'gh-stranger': { id: 9999, login: 'stranger' },
};
// login -> org -> role
const githubMemberships = {
  alice: { acme: 'admin', beta: 'member', 'no-app': 'admin' },
  bob: { acme: 'member' },
};
const githubInstallations = { 'orgs/acme': 555, 'users/alice': 777 };

const gitlabUsers = { 'gl-carol': { id: 7, username: 'carol' }, 'gl-dave': { id: 8, username: 'dave' } };
// group -> user id -> access level
const gitlabMembers = { grp: { 7: 50, 8: 30 } };

// OAuth codes the fake platforms accept, and the user token each one returns.
const oauthCodes = { github: { 'code-alice': 'gh-alice' }, gitlab: { 'code-carol': 'gl-carol' } };
const OAUTH_CLIENT = { id: 'client-id', secret: 'client-secret' };

function bearer(req) {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  return match && match[1];
}

function createMockPlatform() {
  const app = express();
  const gh = express.Router();
  const gl = express.Router();

  gh.use((req, res, next) => {
    if (req.path.endsWith('/installation')) return next();
    req.user = githubUsers[bearer(req)];
    return req.user ? next() : res.status(401).json({ message: 'Bad credentials' });
  });
  gh.get('/user', (req, res) => res.json(req.user));
  gh.get('/user/memberships/orgs', (req, res) => {
    const orgs = githubMemberships[req.user.login] || {};
    const page = Number(req.query.page) || 1;
    const all = Object.entries(orgs).map(([org, role]) => ({ state: 'active', role, organization: { login: org } }));
    res.json(page === 1 ? all : []);
  });
  gh.get('/user/memberships/orgs/:org', (req, res) => {
    const role = (githubMemberships[req.user.login] || {})[req.params.org];
    return role ? res.json({ state: 'active', role }) : res.status(404).json({ message: 'Not Found' });
  });
  gh.get('/:kind/:name/installation', (req, res) => {
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.get('authorization') || '')) return res.status(401).end();
    const id = githubInstallations[`${req.params.kind}/${req.params.name}`];
    return id ? res.json({ id }) : res.status(404).json({ message: 'Not Found' });
  });

  gl.use((req, res, next) => {
    req.user = gitlabUsers[bearer(req)];
    return req.user ? next() : res.status(401).json({ message: '401 Unauthorized' });
  });
  gl.get('/user', (req, res) => res.json(req.user));
  gl.get('/groups', (req, res) => {
    const min = Number(req.query.min_access_level) || 0;
    const groups = Object.entries(gitlabMembers)
      .filter(([, members]) => (members[req.user.id] || 0) >= min)
      .map(([path]) => ({ full_path: path }));
    res.json(Number(req.query.page) > 1 ? [] : groups);
  });
  gl.get('/groups/:group/members/all/:userId', (req, res) => {
    const level = (gitlabMembers[req.params.group] || {})[req.params.userId];
    return level ? res.json({ access_level: level }) : res.status(404).json({ message: '404 Not found' });
  });

  // GitHub answers a bad code with 200 and an error field; GitLab with 400.
  app.post('/ghweb/login/oauth/access_token', express.json(), (req, res) => {
    const ok = req.body.client_id === OAUTH_CLIENT.id && req.body.client_secret === OAUTH_CLIENT.secret;
    const token = ok && oauthCodes.github[req.body.code];
    res.json(token ? { access_token: token, token_type: 'bearer' } : { error: 'bad_verification_code' });
  });
  app.post('/glweb/oauth/token', express.json(), (req, res) => {
    const ok =
      req.body.client_id === OAUTH_CLIENT.id && req.body.client_secret === OAUTH_CLIENT.secret && req.body.grant_type === 'authorization_code';
    const token = ok && oauthCodes.gitlab[req.body.code];
    return token ? res.json({ access_token: token, token_type: 'Bearer' }) : res.status(400).json({ error: 'invalid_grant' });
  });

  app.use('/gh', gh);
  app.use('/gl', gl);
  return app;
}

// Starts the mock and points the server's config at it. Call before requiring src/.
async function startMockPlatform() {
  const server = createMockPlatform().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GITHUB_API_URL = `${base}/gh`;
  process.env.GITLAB_API_URL = `${base}/gl`;
  process.env.GITHUB_URL = `${base}/ghweb`;
  process.env.GITLAB_URL = `${base}/glweb`;
  process.env.GITHUB_CLIENT_ID = OAUTH_CLIENT.id;
  process.env.GITHUB_CLIENT_SECRET = OAUTH_CLIENT.secret;
  process.env.GITLAB_CLIENT_ID = OAUTH_CLIENT.id;
  process.env.GITLAB_CLIENT_SECRET = OAUTH_CLIENT.secret;
  process.env.GITHUB_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' });
  return server;
}

module.exports = { startMockPlatform };
