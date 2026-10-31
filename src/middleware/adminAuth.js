const { platformCaller, findAccount } = require('./userAuth');
const { OWNER } = require('../services/roles');
const { HttpError } = require('../errors');

// The owner API opens only for a platform's owner (GITHUB_ADMIN_ID / GITLAB_ADMIN_ID, see
// ownerService), signed in with their own GitHub or GitLab token. Every request works on that
// one platform (X-Platform): a GitHub session sees only GitHub users, orgs, repositories and
// keys, and a GitLab session only GitLab ones. Any other valid platform user gets 403.
async function adminAuth(req, _res, next) {
  try {
    if (!req.get('x-platform')) throw new HttpError(401, 'Unauthorized');
    const caller = await platformCaller(req);
    const account = await findAccount(caller);
    if (!account || account.role !== OWNER) throw new HttpError(403, 'not an owner');
    req.admin = { platform: caller.platform, id: caller.id, login: caller.login, token: caller.token };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { adminAuth };
