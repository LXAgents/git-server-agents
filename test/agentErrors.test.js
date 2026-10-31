const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { AgentError, classify, formatReply, resetTime } = require('../src/services/agentErrors');
const openRouter = require('../src/services/openRouterService');

function providerError(status, message, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.source = 'openrouter';
  err.response = { status, data: { error: { code: status, message } }, headers };
  return err;
}

test('maps each OpenRouter status to a stable code', () => {
  const cases = [
    [401, 'No auth credentials found', 'INVALID_API_KEY'],
    [402, 'Insufficient credits', 'INSUFFICIENT_CREDITS'],
    [403, 'Input was flagged by moderation', 'CONTENT_FLAGGED'],
    [404, 'No endpoints found for x/y', 'MODEL_NOT_FOUND'],
    [400, 'x/y is not a valid model ID', 'MODEL_NOT_FOUND'],
    [400, 'messages must not be empty', 'BAD_REQUEST'],
    [408, 'Request timed out', 'TIMEOUT'],
    [429, 'Rate limit exceeded', 'RATE_LIMITED'],
    [500, 'Internal Server Error', 'PROVIDER_ERROR'],
    [502, 'Provider returned error', 'PROVIDER_UNAVAILABLE'],
    [503, 'No available providers', 'PROVIDER_UNAVAILABLE'],
  ];
  for (const [status, message, code] of cases) {
    const info = classify(providerError(status, message));
    assert.equal(info.code, code, `${status} ${message}`);
    assert.equal(info.status, status);
    assert.equal(info.detail, message);
  }
});

test('a timeout or unreachable OpenRouter has no status', () => {
  const timeout = Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED', source: 'openrouter' });
  assert.equal(classify(timeout).code, 'TIMEOUT');
  const down = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND', source: 'openrouter' });
  assert.equal(classify(down).code, 'PROVIDER_UNAVAILABLE');
});

test('platform, agent and unknown errors', () => {
  const platform = Object.assign(new Error('403'), { response: { status: 403, data: { message: 'Resource not accessible by integration' } } });
  assert.deepEqual([classify(platform).code, classify(platform).status], ['PLATFORM_ERROR', 403]);
  assert.equal(classify(new AgentError('NO_API_KEY', 'none')).code, 'NO_API_KEY');
  const internal = classify(new Error('ENOENT /srv/app/secret.json'));
  assert.equal(internal.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(internal.detail, /secret/);
});

test('a rate limit says when to retry, from Retry-After or X-RateLimit-Reset', () => {
  const now = Date.parse('2026-10-31T22:00:00Z');
  assert.equal(resetTime({ 'retry-after': '90' }, now).toISOString(), '2026-10-31T22:01:30.000Z');
  assert.equal(resetTime({ 'x-ratelimit-reset': String(now + 600_000) }, now).toISOString(), '2026-10-31T22:10:00.000Z');
  const reply = formatReply(providerError(429, 'Rate limit exceeded', { 'retry-after': '600' }), { model: 'm/x', taskId: 't9', now });
  assert.match(reply, /`RATE_LIMITED` · HTTP 429/);
  assert.match(reply, /Retry after 22:10 UTC \(in about 10 minutes\)/);
});

test('the free-model daily limit is explained', () => {
  const reply = formatReply(providerError(429, 'Rate limit exceeded: free-models-per-day'));
  assert.match(reply, /daily limit for free models/);
});

test('quoted provider text cannot break out of its code span, mention anyone or show a key', () => {
  const reply = formatReply(providerError(401, 'bad key sk-or-v1-abcdef123456 `x` @alice\nline two'));
  assert.match(reply, /`bad key sk-… 'x' @alice line two`/);
  assert.doesNotMatch(reply, /abcdef/);
});

test('OpenRouter errors inside a 200 response are thrown with their real status', async (t) => {
  t.mock.method(axios, 'post', async () => ({ data: { error: { code: 429, message: 'Upstream rate limited' } } }));
  await assert.rejects(openRouter.complete({ baseUrl: 'https://or.test', apiKey: 'k', model: 'm', messages: [] }), (err) => {
    assert.equal(classify(err).code, 'RATE_LIMITED');
    return true;
  });
  t.mock.method(axios, 'post', async () => ({ data: { choices: [{ error: { code: 502, message: 'Provider down' } }] } }));
  await assert.rejects(openRouter.complete({ baseUrl: 'https://or.test', apiKey: 'k', model: 'm', messages: [] }), (err) => {
    assert.equal(classify(err).code, 'PROVIDER_UNAVAILABLE');
    return true;
  });
  t.mock.method(axios, 'post', async () => ({ data: { choices: [{ message: { content: '' } }] } }));
  await assert.rejects(openRouter.complete({ baseUrl: 'https://or.test', apiKey: 'k', model: 'm', messages: [] }), (err) => {
    assert.equal(classify(err).code, 'EMPTY_RESPONSE');
    return true;
  });
});

test('HTTP errors from OpenRouter are tagged as provider errors', async (t) => {
  t.mock.method(axios, 'post', async () => {
    throw providerError(401, 'User not found.');
  });
  await assert.rejects(openRouter.complete({ baseUrl: 'https://or.test', apiKey: 'k', model: 'm', messages: [] }), (err) => {
    assert.equal(err.source, 'openrouter');
    assert.equal(classify(err).code, 'INVALID_API_KEY');
    return true;
  });
});
