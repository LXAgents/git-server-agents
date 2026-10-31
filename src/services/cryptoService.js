const crypto = require('crypto');
const config = require('../config');

// API keys are stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts), AES-256-GCM.
const VERSION = 'v1';

function loadKey(raw = config.encryptionKey) {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64');
  }
  return key;
}

function encrypt(plaintext, rawKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(rawKey), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (Buffer.isBuffer(p) ? p.toString('base64') : p)).join(':');
}

function decrypt(encoded, rawKey) {
  const [version, iv, tag, data] = String(encoded).split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('unrecognised encrypted key format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(rawKey), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
