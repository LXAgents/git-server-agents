const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyGithubSignature, verifyGitlabToken } = require('../src/services/signatureService');

const body = Buffer.from('{"hello":"world"}');
const sign = (secret) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

test('accepts a GitHub signature made with the secret', () => {
  assert.equal(verifyGithubSignature(body, sign('s3cret'), 's3cret'), true);
});

test('rejects a GitHub signature made with another secret, or none', () => {
  assert.equal(verifyGithubSignature(body, sign('other'), 's3cret'), false);
  assert.equal(verifyGithubSignature(body, undefined, 's3cret'), false);
  assert.equal(verifyGithubSignature(body, sign('s3cret'), ''), false);
});

test('compares GitLab tokens exactly', () => {
  assert.equal(verifyGitlabToken('tok', 'tok'), true);
  assert.equal(verifyGitlabToken('tok2', 'tok'), false);
  assert.equal(verifyGitlabToken(undefined, 'tok'), false);
});
