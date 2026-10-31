const test = require('node:test');
const assert = require('node:assert/strict');
const { trimTrailingSlashes } = require('../src/utils/strings');

test('trims trailing slashes only', () => {
  assert.equal(trimTrailingSlashes('https://example.com///'), 'https://example.com');
  assert.equal(trimTrailingSlashes('src/a/'), 'src/a');
  assert.equal(trimTrailingSlashes('/'), '');
  assert.equal(trimTrailingSlashes(''), '');
  assert.equal(trimTrailingSlashes('no/slash'), 'no/slash');
});

test('stays fast on a long run of slashes', () => {
  const input = `${'/'.repeat(200_000)}x`;
  const started = Date.now();
  assert.equal(trimTrailingSlashes(input), input);
  assert.ok(Date.now() - started < 200);
});
