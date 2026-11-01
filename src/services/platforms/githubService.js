const crypto = require('crypto');
const axios = require('axios');
require('../../http');
const config = require('../../config');

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

// Marks a comment as picked up with an emoji reaction. Issue and PR conversation comments use
// the issues endpoint; inline review comments use the pulls one.
async function addReaction(repo, commentId, { review = false, content = 'eyes' } = {}, token) {
  const kind = review ? 'pulls' : 'issues';
  await axios.post(`${repoUrl(repo)}/${kind}/comments/${commentId}/reactions`, { content }, { headers: headers(token) });
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

// The commenter's permission on `repo`: "admin", "write", "read" or "none". GitHub reports
// the maintain role as "write" and triage as "read". 404 means no access at all.
async function getCollaboratorPermission(repo, login, token) {
  const res = await axios.get(`${repoUrl(repo)}/collaborators/${encodeURIComponent(login)}/permission`, {
    headers: headers(token),
    validateStatus: (status) => status === 200 || status === 404,
  });
  return res.status === 200 ? (res.data && res.data.permission) || 'none' : 'none';
}

async function createIssue(repo, { title, body, labels }, token) {
  const { data } = await axios.post(`${repoUrl(repo)}/issues`, { title, body, ...(labels ? { labels } : {}) }, { headers: headers(token) });
  return { number: data.number, url: data.html_url, state: data.state };
}

// Opens or closes an issue. GitHub's issues endpoint would also close a pull request with the
// same number, so a number that is a pull request is refused instead.
async function setIssueState(repo, number, state, { reason } = {}, token) {
  const { data: issue } = await axios.get(`${repoUrl(repo)}/issues/${number}`, { headers: headers(token) });
  if (issue.pull_request) {
    throw Object.assign(new Error(`#${number} is a pull request, not an issue`), { notIssue: true });
  }
  const { data } = await axios.patch(
    `${repoUrl(repo)}/issues/${number}`,
    { state, ...(reason ? { state_reason: reason } : {}) },
    { headers: headers(token) }
  );
  return { number: data.number, url: data.html_url, state: data.state };
}

async function createPullRequest(repo, { title, body, head, base, draft }, token) {
  const { data } = await axios.post(`${repoUrl(repo)}/pulls`, { title, body, head, base, draft: Boolean(draft) }, { headers: headers(token) });
  return { number: data.number, url: data.html_url, state: data.state };
}

// Opens or closes a pull request. A merged pull request cannot be reopened; GitHub answers 422.
async function setPullRequestState(repo, number, state, token) {
  const { data } = await axios.patch(`${repoUrl(repo)}/pulls/${number}`, { state }, { headers: headers(token) });
  return { number: data.number, url: data.html_url, state: data.merged ? 'merged' : data.state };
}

// One issue by number. A pull request is an issue too on GitHub; `pull_request` tells them apart.
async function getIssue(repo, number, token) {
  const { data } = await axios.get(`${repoUrl(repo)}/issues/${number}`, { headers: headers(token) });
  return {
    number: data.number,
    title: data.title || '',
    state: data.state,
    author: (data.user && data.user.login) || '',
    labels: (data.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    body: data.body || '',
    url: data.html_url,
    isPull: Boolean(data.pull_request),
  };
}

async function getPullByNumber(repo, number, token) {
  const { data } = await axios.get(`${repoUrl(repo)}/pulls/${number}`, { headers: headers(token) });
  return {
    number: data.number,
    title: data.title || '',
    state: data.merged ? 'merged' : data.state,
    author: (data.user && data.user.login) || '',
    labels: (data.labels || []).map((l) => l.name),
    body: data.body || '',
    url: data.html_url,
    head: (data.head && data.head.ref) || '',
    base: (data.base && data.base.ref) || '',
    apiUrl: data.url,
  };
}

// A pull request's commits, oldest first (GitHub returns at most 250).
async function listPullCommits(repo, number, token, { maxPages = 3 } = {}) {
  const commits = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await axios.get(`${repoUrl(repo)}/pulls/${number}/commits`, { headers: headers(token), params: { per_page: 100, page } });
    commits.push(...data);
    if (data.length < 100) break;
  }
  return commits.map((c) => ({
    sha: c.sha,
    title: String((c.commit && c.commit.message) || '').split('\n')[0],
    author: (c.author && c.author.login) || (c.commit && c.commit.author && c.commit.author.name) || '',
  }));
}

// One commit's message and diff, rebuilt from its per-file patches.
async function getCommit(repo, sha, token) {
  const { data } = await axios.get(`${repoUrl(repo)}/commits/${encodeURIComponent(sha)}`, { headers: headers(token) });
  const diff = (data.files || [])
    .map((f) => `diff --git a/${f.previous_filename || f.filename} b/${f.filename}\n${f.patch || `[${f.status}, no text diff]`}`)
    .join('\n');
  return {
    sha: data.sha,
    message: (data.commit && data.commit.message) || '',
    author: (data.author && data.author.login) || (data.commit && data.commit.author && data.commit.author.name) || '',
    diff,
  };
}

module.exports = {
  isCollaborator,
  appJwt,
  installationToken,
  getPullDiff,
  getPull,
  postComment,
  addReaction,
  listIssueComments,
  getRepoTree,
  getFileContent,
  isOrgMember,
  getCollaboratorPermission,
  createIssue,
  setIssueState,
  createPullRequest,
  setPullRequestState,
  getIssue,
  getPullByNumber,
  listPullCommits,
  getCommit,
};
