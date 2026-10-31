const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GITHUB_CLIENT_ID = 'Iv23liExample';
process.env.GITHUB_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).replace(/\n/g, '\\n');

const { appJwt } = require('../src/services/githubService');

test('signs a GitHub App JWT, issued by the client ID, that verifies with the public key', () => {
  const now = 1_700_000_000;
  const [header, payload, signature] = appJwt(now).split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iat: now - 60, exp: now + 540, iss: 'Iv23liExample' });
});
