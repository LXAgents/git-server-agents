// OAuth sign-in for the dashboard with the GitHub App's or GitLab application's client ID and
// secret. The resulting user token is used exactly like a pasted personal access token, so the
// whitelist and the live owner checks stay where they are.
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const { HttpError } = require('../errors');

const STATE_TTL_MS = 10 * 60 * 1000;

const PROVIDERS = {
  github: {
    authorizeUrl: (web) => `${web}/login/oauth/authorize`,
    tokenUrl: (web) => `${web}/login/oauth/access_token`,
    // An OAuth App needs read:org for the owner checks; a GitHub App ignores scopes and uses
    // its "Members: read" organization permission instead.
    scope: 'read:org',
    extraToken: {},
  },
  gitlab: {
    authorizeUrl: (web) => `${web}/oauth/authorize`,
    tokenUrl: (web) => `${web}/oauth/token`,
    scope: 'read_api',
    extraToken: { grant_type: 'authorization_code' },
  },
};

function isEnabled(platform) {
  const settings = config[platform];
  return Boolean(PROVIDERS[platform] && settings.clientId && settings.clientSecret);
}

function providers() {
  return Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, isEnabled(p)]));
}

function requireEnabled(platform) {
  if (!PROVIDERS[platform]) throw new HttpError(404, 'unknown platform');
  if (!isEnabled(platform)) throw new HttpError(404, `${platform} sign-in is not configured`);
}

// The token is handed to `redirect`, so only an exact, listed dashboard origin may receive it.
function checkRedirect(redirect) {
  let url;
  try {
    url = new URL(String(redirect || ''));
  } catch {
    throw new HttpError(400, 'redirect must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !config.corsOrigins.includes(url.origin)) {
    throw new HttpError(400, 'redirect origin is not in CORS_ORIGINS');
  }
  url.hash = '';
  return url.toString();
}

function stateKey() {
  if (!config.encryptionKey) throw new HttpError(503, 'ENCRYPTION_KEY is required for sign-in');
  return crypto.createHash('sha256').update(`oauth-state:${config.encryptionKey}`).digest();
}

const mac = (body) => crypto.createHmac('sha256', stateKey()).update(body).digest();

// `nonce` is also set as a cookie on this browser, so a callback started elsewhere is refused.
function signState({ platform, redirect, nonce }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ platform, redirect, nonce, exp: now + STATE_TTL_MS })).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

function verifyState(state, now = Date.now()) {
  const [body, signature, extra] = String(state || '').split('.');
  if (!body || !signature || extra !== undefined) throw new HttpError(400, 'invalid sign-in state');
  const given = Buffer.from(signature, 'base64url');
  const expected = mac(body);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new HttpError(400, 'invalid sign-in state');
  }
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof data.exp !== 'number' || data.exp < now) throw new HttpError(400, 'sign-in expired, try again');
  return data;
}

function authorizeUrl(platform, { redirectUri, state }) {
  const settings = config[platform];
  const provider = PROVIDERS[platform];
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: provider.scope,
    state,
  });
  return `${provider.authorizeUrl(settings.webUrl)}?${params}`;
}

async function exchangeCode(platform, { code, redirectUri }) {
  const settings = config[platform];
  const provider = PROVIDERS[platform];
  let data;
  try {
    ({ data } = await axios.post(
      provider.tokenUrl(settings.webUrl),
      {
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        redirect_uri: redirectUri,
        ...provider.extraToken,
      },
      { headers: { Accept: 'application/json' }, timeout: 15_000 }
    ));
  } catch (err) {
    const reason = (err.response && err.response.data && err.response.data.error) || err.message;
    throw new HttpError(502, `${platform} sign-in failed: ${reason}`);
  }
  // GitHub reports a bad code with 200 and an `error` field.
  if (!data || !data.access_token) {
    throw new HttpError(502, `${platform} sign-in failed: ${(data && data.error) || 'no access token'}`);
  }
  return data.access_token;
}

module.exports = { providers, requireEnabled, checkRedirect, signState, verifyState, authorizeUrl, exchangeCode };
