const crypto = require('crypto');

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// GitHub signs the raw body with HMAC-SHA256 and sends it as "sha256=<hex>".
function verifyGithubSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, signature);
}

// GitLab sends the configured secret token verbatim in X-Gitlab-Token.
function verifyGitlabToken(token, secret) {
  if (!secret || !token) return false;
  return safeEqual(token, secret);
}

module.exports = { verifyGithubSignature, verifyGitlabToken };
