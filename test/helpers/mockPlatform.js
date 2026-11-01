// A fake GitHub and GitLab for tests. The APIs are served under /gh and /gl, and the OAuth
// web endpoints under /ghweb and /glweb.
const crypto = require('crypto');
const express = require('express');

const githubUsers = {
  'gh-alice': { id: 1001, login: 'alice', name: 'Alice Liddell', avatar_url: 'https://avatars.example/1001' },
  'gh-bob': { id: 1002, login: 'bob' },
  'gh-stranger': { id: 9999, login: 'stranger' },
};
// login -> org -> role
const githubMemberships = {
  alice: { acme: 'admin', beta: 'member', 'no-app': 'admin' },
  bob: { acme: 'member' },
};
const githubInstallations = { 'orgs/acme': 555, 'users/alice': 777 };

// login -> repos the user can see, with their admin flag
const githubRepos = {
  alice: [
    { id: 301, full_name: 'acme/web', owner: { login: 'acme' }, permissions: { admin: true } },
    { id: 302, full_name: 'acme/docs', owner: { login: 'acme' }, permissions: { admin: false } },
    { id: 303, full_name: 'beta/app', owner: { login: 'beta' }, permissions: { admin: true } },
  ],
  bob: [{ id: 301, full_name: 'acme/web', owner: { login: 'acme' }, permissions: { admin: false } }],
};
// GitLab project id -> path and user id -> access level
const gitlabProjects = { 41: { path: 'grp/app', members: { 7: 50, 8: 30 } } };

// OpenRouter's /models answer.
const openRouterModels = [
  { id: 'openai/gpt-5', name: 'GPT-5', context_length: 400000, pricing: { prompt: '0.00000125', completion: '0.00001' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'openrouter/free', name: 'Free Models Router', context_length: 200000, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/imagen', name: 'Imagen', pricing: { prompt: '0.1', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
];

// Other providers' /models answers, and every chat request the mock answered.
const openAiModels = [{ id: 'gpt-5', owned_by: 'openai' }, { id: 'text-embedding-3-small', owned_by: 'openai' }, { id: 'gpt-5-mini', owned_by: 'openai' }];
const anthropicModels = [
  { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z', max_input_tokens: 1000000 },
  { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' },
];
const chatRequests = [];

const gitlabUsers = { 'gl-carol': { id: 7, username: 'carol', name: 'Carol', avatar_url: 'https://gitlab.example/7.png' }, 'gl-dave': { id: 8, username: 'dave' } };
// How many public profile lookups each platform answered, so tests can see the cache work.
const profileLookups = { github: 0, gitlab: 0 };
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

  // Public profiles by numeric ID answer without a token, as on the real platforms.
  gh.get('/user/:id', (req, res, next) => {
    // /user/repos, /user/memberships and the like are the signed-in user's own routes.
    if (!/^\d+$/.test(req.params.id)) return next();
    profileLookups.github += 1;
    const user = Object.values(githubUsers).find((u) => String(u.id) === req.params.id);
    return user ? res.json(user) : res.status(404).json({ message: 'Not Found' });
  });
  gl.get('/users/:id', (req, res) => {
    profileLookups.gitlab += 1;
    const user = Object.values(gitlabUsers).find((u) => String(u.id) === req.params.id);
    return user ? res.json(user) : res.status(404).json({ message: '404 User Not Found' });
  });

  gh.use((req, res, next) => {
    if (req.path === '/app/installations') return next();
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
  gh.get('/user/repos', (req, res) => res.json(Number(req.query.page) > 1 ? [] : githubRepos[req.user.login] || []));
  gh.get('/repos/:owner/:name', (req, res) => {
    const repo = (githubRepos[req.user.login] || []).find((r) => r.full_name === `${req.params.owner}/${req.params.name}`);
    return repo ? res.json(repo) : res.status(404).json({ message: 'Not Found' });
  });
  gh.get('/app/installations', (req, res) => {
    if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.get('authorization') || '')) return res.status(401).end();
    if ((Number(req.query.page) || 1) > 1) return res.json([]);
    res.json(
      Object.entries(githubInstallations).map(([key, id]) => {
        const [kind, login] = key.split('/');
        return { id, account: { login, type: kind === 'users' ? 'User' : 'Organization' } };
      })
    );
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
  gl.get('/projects', (req, res) => {
    const min = Number(req.query.min_access_level) || 0;
    const projects = Object.entries(gitlabProjects)
      .filter(([, p]) => (p.members[req.user.id] || 0) >= min)
      .map(([id, p]) => ({ id: Number(id), path_with_namespace: p.path }));
    res.json(Number(req.query.page) > 1 ? [] : projects);
  });
  gl.get('/projects/:id/members/all/:userId', (req, res) => {
    const level = ((gitlabProjects[req.params.id] || {}).members || {})[req.params.userId];
    return level ? res.json({ id: Number(req.params.userId), access_level: level }) : res.status(404).json({ message: '404 Not found' });
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

  app.get('/or/models', (_req, res) => res.json({ data: openRouterModels }));

  // OpenAI-compatible providers list models only to a key holder.
  const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '');
  app.get('/oa/models', (req, res) => {
    if (bearer(req) !== 'sk-openai-good') return res.status(401).json({ error: { message: 'Incorrect API key provided' } });
    return res.json({ object: 'list', data: openAiModels });
  });
  app.post('/oa/chat/completions', express.json(), (req, res) => {
    if (bearer(req) !== 'sk-openai-good') return res.status(401).json({ error: { message: 'Incorrect API key provided' } });
    chatRequests.push({ provider: 'openai', body: req.body });
    return res.json({ choices: [{ message: { role: 'assistant', content: `openai says hi to ${req.body.model}` } }] });
  });
  app.get('/ds/models', (req, res) => res.json({ data: bearer(req) ? [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] : [] }));
  app.get('/zai/models', (_req, res) => res.status(404).json({ error: { message: 'not found' } }));

  // Anthropic's Messages API (/v1 is added by the SDK, which sends the key as a bearer token).
  const anthropicKey = (req) => req.headers['x-api-key'] || bearer(req);
  app.get('/an/v1/models', (req, res) => {
    if (anthropicKey(req) !== 'sk-ant-good') return res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    return res.json({ data: anthropicModels, has_more: false, first_id: anthropicModels[0].id, last_id: anthropicModels.at(-1).id });
  });
  app.post('/an/v1/messages', express.json(), (req, res) => {
    if (anthropicKey(req) !== 'sk-ant-good') return res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    chatRequests.push({ provider: 'anthropic', body: req.body });
    return res.json({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: req.body.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: `anthropic says hi to ${req.body.model}` }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
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
  process.env.OPENROUTER_API_URL = `${base}/or`;
  process.env.OPENAI_API_URL = `${base}/oa`;
  process.env.ANTHROPIC_API_URL = `${base}/an`;
  process.env.DEEPSEEK_API_URL = `${base}/ds`;
  process.env.ZAI_API_URL = `${base}/zai`;
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

module.exports = { startMockPlatform, profileLookups, chatRequests };
