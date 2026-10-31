const crypto = require('crypto');
const config = require('../config');
const { PLATFORMS } = require('../services/platformService');
const { platformCaller, findAccount } = require('./userAuth');
const { OWNER } = require('../services/roles');
const { HttpError } = require('../errors');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

function tokenMatches(req) {
  const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expected = config.adminToken;
  return Boolean(expected && supplied && crypto.timingSafeEqual(digest(supplied), digest(expected)));
}

// Every owner request works on one platform, named by X-Platform: a GitHub session sees only
// GitHub orgs, repos, keys and users, and a GitLab session only GitLab ones.
// Two ways in:
// - The operator's static ADMIN_TOKEN, as "Bearer <token>" or the bare token. With no
//   ADMIN_TOKEN configured this way is closed rather than open.
// - A GitHub or GitLab user token whose account has the "owner" role. Any other valid platform
//   user gets 403.
async function adminAuth(req, _res, next) {
  try {
    const platform = String(req.get('x-platform') || '').toLowerCase();
    if (tokenMatches(req)) {
      if (!PLATFORMS.includes(platform)) throw new HttpError(400, 'X-Platform must be github or gitlab');
      req.admin = { via: 'token', platform, token: null };
      return next();
    }
    if (!platform) throw new HttpError(401, 'Unauthorized');
    const caller = await platformCaller(req);
    const account = await findAccount(caller);
    if (!account || account.role !== OWNER) throw new HttpError(403, 'not an owner');
    req.admin = { via: caller.platform, platform: caller.platform, id: caller.id, login: caller.login, token: caller.token };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { adminAuth };
