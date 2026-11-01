// Trying an answer with each allowed key in turn.
const log = require('../logService');

// 400 and 404 mean the request itself is wrong (bad model id, malformed body), so every
// other key would fail the same way. Anything else (401, 402, 403, 429, 5xx, timeouts,
// network errors, empty replies) is worth retrying with the next key.
function isKeySpecific(err) {
  const status = err.response && err.response.status;
  return status !== 400 && status !== 404;
}

// Runs `attempt(key)` with each key in order until one succeeds. The error thrown at the end
// lists every attempt (owner and status, never the key) as `attempts`.
async function chatWithFallback(candidates, attempt, logMeta) {
  let lastError;
  const attempts = [];
  for (const [index, key] of candidates.entries()) {
    try {
      return await attempt(key);
    } catch (err) {
      lastError = err;
      const status = (err.response && err.response.status) || err.code || 'error';
      attempts.push({ owner: key.owner, status });
      err.attempts = attempts;
      if (!isKeySpecific(err) || err.deadline) throw err;
      if (index < candidates.length - 1) {
        log.warn('agent', `${key.owner} key ${key.id} failed (${status}), falling back to next...`, logMeta);
      }
    }
  }
  throw lastError;
}

module.exports = { chatWithFallback, isKeySpecific };
