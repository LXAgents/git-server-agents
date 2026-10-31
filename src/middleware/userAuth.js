const platforms = require('../services/platformService');
const profiles = require('../services/profileService');
const owners = require('../services/ownerService');
const { HttpError } = require('../errors');

// Who the caller is on the platform, from their own token:
//   X-Platform: github | gitlab
//   Authorization: Bearer <OAuth or personal access token>
async function platformCaller(req) {
  const platform = String(req.get('x-platform') || '').toLowerCase();
  if (!platforms.PLATFORMS.includes(platform)) throw new HttpError(400, 'X-Platform must be github or gitlab');
  // \s+ and \S+ can't overlap, so this stays linear on any header.
  const match = /^Bearer\s+(\S+)$/i.exec(String(req.get('authorization') || '').trim());
  if (!match) throw new HttpError(401, 'missing bearer token');
  const token = match[1].trim();
  const user = await platforms.getUser(platform, token);
  profiles.remember(platform, user.id, user);
  return { ...user, token };
}

// The caller's whitelisted account, or null. The one configured owner ID is whitelisted, and
// made owner, on first sign-in (see ownerService).
function findAccount(caller) {
  return owners.syncAccount(caller.platform, caller.id);
}

// Signs a request in with the caller's own GitHub or GitLab token. The caller must also be
// whitelisted by hand, unless their ID is the platform's configured owner.
async function userAuth(req, _res, next) {
  try {
    const caller = await platformCaller(req);
    const account = await findAccount(caller);
    if (!account) throw new HttpError(403, 'user is not whitelisted');
    req.user = { ...caller, account, role: account.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { userAuth, platformCaller, findAccount };
