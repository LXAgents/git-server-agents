const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startMockPlatform } = require('./helpers/mockPlatform');

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.PUBLIC_URL = 'https://agents.example.com/';

const DASHBOARD = 'http://localhost:5173/';

let mock;
let server;
let base;
let prisma;
let oauth;

test.before(async () => {
  mock = await startMockPlatform();
  prisma = require('../src/db');
  oauth = require('../src/services/platforms/oauthService');
  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  mock.close();
  await prisma.$disconnect();
});

const get = (path, headers = {}) => fetch(`${base}${path}`, { redirect: 'manual', headers });

async function start(platform) {
  const res = await get(`/api/auth/${platform}/start?redirect=${encodeURIComponent(DASHBOARD)}`);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return { location, cookie, state: location.searchParams.get('state') };
}

function fragment(res) {
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.ok(location.startsWith(`${DASHBOARD}#`), location);
  return Object.fromEntries(new URLSearchParams(location.slice(DASHBOARD.length + 1)));
}

test('lists the platforms that have a client ID and secret', async () => {
  const res = await get('/api/auth/providers', { origin: 'http://localhost:5173' });
  assert.deepEqual(await res.json(), { github: true, gitlab: true });
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('start sends the browser to GitHub with the client ID, callback, scope and a nonce cookie', async () => {
  const { location, cookie } = await start('github');
  assert.equal(location.pathname, '/ghweb/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://agents.example.com/api/auth/github/callback');
  assert.equal(location.searchParams.get('scope'), 'read:org');
  assert.match(cookie, /^gsa_oauth_nonce=[\w-]{22}$/);
});

test('start refuses a redirect outside CORS_ORIGINS and an unknown platform', async () => {
  for (const redirect of ['https://evil.example/', 'http://localhost:5173.evil.example/', 'javascript:alert(1)', 'not a url']) {
    const res = await get(`/api/auth/github/start?redirect=${encodeURIComponent(redirect)}`);
    assert.equal(res.status, 400, redirect);
  }
  assert.equal((await get(`/api/auth/bitbucket/start?redirect=${encodeURIComponent(DASHBOARD)}`)).status, 404);
});

const exchange = (code) =>
  fetch(`${base}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ code }),
  });

test('a GitHub callback sends back a one-time code, never the token, and the code is exchanged once', async () => {
  const { state, cookie } = await start('github');
  const res = await get(`/api/auth/github/callback?code=code-alice&state=${state}`, { cookie });
  assert.doesNotMatch(res.headers.get('location'), /gh-alice/);
  const back = fragment(res);
  assert.deepEqual(Object.keys(back), ['code']);
  const first = await exchange(back.code);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { platform: 'github', token: 'gh-alice' });
  const again = await exchange(back.code);
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /already used/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('set-cookie'), /gsa_oauth_nonce=;.*Max-Age=0/);
});

test('a GitLab callback sends grant_type and returns the user token', async () => {
  const { location, state, cookie } = await start('gitlab');
  assert.equal(location.pathname, '/glweb/oauth/authorize');
  assert.equal(location.searchParams.get('scope'), 'read_api');
  const res = await get(`/api/auth/gitlab/callback?code=code-carol&state=${state}`, { cookie });
  assert.deepEqual(await (await exchange(fragment(res).code)).json(), { platform: 'gitlab', token: 'gl-carol' });
});

test('a callback without the nonce cookie from start is refused', async () => {
  const { state } = await start('github');
  const res = await get(`/api/auth/github/callback?code=code-alice&state=${state}`);
  assert.match(fragment(res).error, /another browser/);
});

test('a bad code or a denied consent comes back as an error, with no token', async () => {
  let { state, cookie } = await start('github');
  let back = fragment(await get(`/api/auth/github/callback?code=wrong&state=${state}`, { cookie }));
  assert.equal(back.token, undefined);
  assert.match(back.error, /bad_verification_code/);

  ({ state, cookie } = await start('gitlab'));
  back = fragment(await get(`/api/auth/gitlab/callback?code=wrong&state=${state}`, { cookie }));
  assert.match(back.error, /invalid_grant/);

  ({ state, cookie } = await start('github'));
  back = fragment(await get(`/api/auth/github/callback?error=access_denied&error_description=Denied&state=${state}`, { cookie }));
  assert.deepEqual(back, { error: 'Denied' });
});

test('a tampered, expired or cross-platform state is rejected', async () => {
  const { state, cookie } = await start('github');
  const [body, mac] = state.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), redirect: 'https://evil.example/' })).toString('base64url')}.${mac}`;
  assert.equal((await get(`/api/auth/github/callback?code=code-alice&state=${tampered}`, { cookie })).status, 400);
  assert.equal((await get(`/api/auth/gitlab/callback?code=code-alice&state=${state}`, { cookie })).status, 400);
  assert.equal((await get('/api/auth/github/callback?code=code-alice&state=junk', { cookie })).status, 400);

  const old = oauth.signState({ platform: 'github', redirect: DASHBOARD, nonce: 'n' }, Date.now() - 11 * 60 * 1000);
  assert.throws(() => oauth.verifyState(old), /expired/);
});

test('an expired, tampered or missing code is refused', async () => {
  const old = oauth.sealToken({ platform: 'github', token: 'gh-old' }, Date.now() - 61_000);
  assert.match((await (await exchange(old)).json()).error, /expired/);
  const good = oauth.sealToken({ platform: 'github', token: 'gh-x' });
  const tampered = `${good.slice(0, -4)}AAAA`;
  assert.equal((await exchange(tampered)).status, 400);
  assert.equal((await exchange('junk')).status, 400);
  assert.equal((await exchange(undefined)).status, 400);
});
