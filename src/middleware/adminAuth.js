const crypto = require('crypto');
const config = require('../config');
const { platformCaller } = require('./userAuth');
const { HttpError } = require('../errors');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function tokenMatches(req) {
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expected = config.adminToken;
  return Boolean(expected && supplied && crypto.timingSafeEqual(digest(supplied), digest(expected)));
}

// Two ways in:
// - The operator's static ADMIN_TOKEN, as "Bearer <token>" or the bare token. With no
//   ADMIN_TOKEN configured this way is closed rather than open.
// - A GitHub or GitLab user token (with X-Platform) whose user ID is in GITHUB_ADMIN_ID or
//   GITLAB_ADMIN_ID. Any other valid platform user gets 403.
async function adminAuth(req, _res, next) {
  try {
    if (!req.get('x-platform')) {
      if (!tokenMatches(req)) throw new HttpError(401, 'Unauthorized');
      req.admin = { via: 'token' };
      return next();
    }
    const caller = await platformCaller(req);
    if (!caller.isAdmin) throw new HttpError(403, 'not an admin');
    req.admin = { via: caller.platform, id: caller.id, login: caller.login };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { adminAuth };
