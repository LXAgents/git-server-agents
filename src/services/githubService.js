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

module.exports = { appJwt, installationToken, getPullDiff, postComment };
