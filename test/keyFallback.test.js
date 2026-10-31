const test = require('node:test');
const assert = require('node:assert/strict');

const openRouter = require('../src/services/openRouterService');
const { chatWithFallback } = require('../src/services/agentService');

const keys = [
  { id: 'u1', owner: 'user', apiKey: 'user-key' },
  { id: 'o1', owner: 'org', apiKey: 'org-key-1' },
  { id: 'o2', owner: 'org', apiKey: 'org-key-2' },
];

function httpError(status) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: {} };
  return err;
}

function stubChat(t, outcomes) {
  const tried = [];
  t.mock.method(openRouter, 'chat', async ({ apiKey }) => {
    tried.push(apiKey);
    const outcome = outcomes[apiKey];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  t.mock.method(console, 'warn', () => {});
  return tried;
}

test('uses the first key when it works', async (t) => {
  const tried = stubChat(t, { 'user-key': 'ok' });
  assert.equal(await chatWithFallback(keys, {}), 'ok');
  assert.deepEqual(tried, ['user-key']);
});

test('falls back past 401, 402, 429 and 5xx in order', async (t) => {
  for (const status of [401, 402, 429, 503]) {
    const tried = stubChat(t, { 'user-key': httpError(status), 'org-key-1': httpError(500), 'org-key-2': 'from org' });
    assert.equal(await chatWithFallback(keys, {}), 'from org');
    assert.deepEqual(tried, ['user-key', 'org-key-1', 'org-key-2']);
    t.mock.restoreAll();
  }
});

test('falls back on network errors', async (t) => {
  const network = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const tried = stubChat(t, { 'user-key': network, 'org-key-1': 'ok' });
  assert.equal(await chatWithFallback(keys, {}), 'ok');
  assert.deepEqual(tried, ['user-key', 'org-key-1']);
});

test('throws the last error when every key fails', async (t) => {
  const last = httpError(429);
  stubChat(t, { 'user-key': httpError(401), 'org-key-1': httpError(402), 'org-key-2': last });
  await assert.rejects(chatWithFallback(keys, {}), (err) => err === last);
});

test('does not burn through keys on a 400 or 404', async (t) => {
  const tried = stubChat(t, { 'user-key': httpError(400) });
  await assert.rejects(chatWithFallback(keys, {}), /400/);
  assert.deepEqual(tried, ['user-key']);
});
