const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');

const tokenCache = new Map();

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// GitHub App JWT (RS256), valid for under ten minutes as GitHub requires. GitHub accepts the
// App's client ID as the issuer, in place of its numeric App ID.
function appJwt(now = Math.floor(Date.now() / 1000)) {
  const { clientId, privateKey } = config.github;
  if (!clientId || !privateKey) throw new Error('GITHUB_CLIENT_ID and GITHUB_PRIVATE_KEY are required');
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

async function installationToken(installationId) {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const { data } = await axios.post(
    `${config.github.apiUrl}/app/installations/${installationId}/access_tokens`,
    {},
    { headers: { Authorization: `Bearer ${appJwt()}`, Accept: 'application/vnd.github+json' } }
  );
  tokenCache.set(installationId, { token: data.token, expiresAt: new Date(data.expires_at).getTime() });
  return data.token;
}

function headers(token, accept = 'application/vnd.github+json') {
  return { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

// The diff comes from the REST API; the repository is never cloned.
async function getPullDiff(pullUrl, token) {
  const { data } = await axios.get(pullUrl, {
    headers: headers(token, 'application/vnd.github.v3.diff'),
    responseType: 'text',
    transformResponse: (raw) => raw,
  });
  return data;
}

async function postComment(repo, number, body, token) {
  const { data } = await axios.post(
    `${config.github.apiUrl}/repos/${repo}/issues/${number}/comments`,
    { body },
    { headers: headers(token) }
  );
  return data;
}

async function getPull(pullUrl, token) {
  const { data } = await axios.get(pullUrl, { headers: headers(token) });
  return data;
}

const encodePath = (path) => String(path).split('/').map(encodeURIComponent).join('/');
const repoUrl = (repo) => `${config.github.apiUrl}/repos/${repo}`;

// The conversation on an issue or PR, oldest first. GitHub has no "newest first" for issue
// comments, so pages are walked (up to `maxPages`) and the last `limit` are kept.
async function listIssueComments(repo, number, token, { limit = 30, maxPages = 10 } = {}) {
  const perPage = 100;
  let comments = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await axios.get(`${repoUrl(repo)}/issues/${number}/comments`, {
      headers: headers(token),
      params: { per_page: perPage, page },
    });
    comments = comments.concat(data).slice(-limit);
    if (data.length < perPage) break;
  }
  return comments.map((c) => ({
    id: c.id,
    author: (c.user && c.user.login) || '',
    isBot: (c.user && c.user.type === 'Bot') || false,
    body: c.body || '',
  }));
}

// Every file path at `ref` (a branch or commit sha), from the Git trees API. No clone.
async function getRepoTree(repo, ref, token) {
  const { data } = await axios.get(`${repoUrl(repo)}/git/trees/${encodeURIComponent(ref)}`, {
    headers: headers(token),
    params: { recursive: 1 },
  });
  const paths = (data.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
  return { paths, truncated: Boolean(data.truncated) };
}

// Raw file content at `ref`, or null when the path does not exist there.
async function getFileContent(repo, path, ref, token) {
  try {
    const { data } = await axios.get(`${repoUrl(repo)}/contents/${encodePath(path)}`, {
      headers: headers(token, 'application/vnd.github.raw+json'),
      params: { ref },
      responseType: 'text',
      transformResponse: (raw) => raw,
    });
    return data;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

// Whether `login` is a member of the organization `org` (204), using the App's
// "Members: read" permission. 404 (or a 302 to the public list) means not a member.
async function isOrgMember(org, login, token) {
  const res = await axios.get(`${config.github.apiUrl}/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(login)}`, {
    headers: headers(token),
    maxRedirects: 0,
    validateStatus: (status) => [204, 302, 404].includes(status),
  });
  return res.status === 204;
}

// Whether `login` is a collaborator on `repo` ("owner/name"), which on an org repo includes
// org members with access. 204 is yes, 404 is no. Needs only the App's Metadata permission.
async function isCollaborator(repo, login, token) {
  const [owner, name] = String(repo).split('/');
  const res = await axios.get(
    `${config.github.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/collaborators/${encodeURIComponent(login)}`,
    { headers: headers(token), validateStatus: (status) => [204, 404].includes(status) }
  );
  return res.status === 204;
}

module.exports = {
  isCollaborator,
  appJwt,
  installationToken,
  getPullDiff,
  getPull,
  postComment,
  listIssueComments,
  getRepoTree,
  getFileContent,
  isOrgMember,
};
