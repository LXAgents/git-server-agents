const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../src/services/cryptoService');

const hexKey = crypto.randomBytes(32).toString('hex');

test('round-trips a key with a hex or base64 encryption key', () => {
  assert.equal(decrypt(encrypt('sk-or-123', hexKey), hexKey), 'sk-or-123');
  const b64 = Buffer.from(hexKey, 'hex').toString('base64');
  assert.equal(decrypt(encrypt('sk-or-456', b64), b64), 'sk-or-456');
});

test('uses a fresh IV each time', () => {
  assert.notEqual(encrypt('same', hexKey), encrypt('same', hexKey));
});

test('fails on a wrong key or tampered ciphertext', () => {
  const sealed = encrypt('secret', hexKey);
  assert.throws(() => decrypt(sealed, crypto.randomBytes(32).toString('hex')));
  const parts = sealed.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decrypt(parts.join(':'), hexKey));
});

test('rejects an encryption key of the wrong length', () => {
  assert.throws(() => encrypt('x', 'short'), /32 bytes/);
});
