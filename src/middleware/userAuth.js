const config = require('../config');
const prisma = require('../db');
const platforms = require('../services/platformService');
const profiles = require('../services/profileService');
const { OWNER } = require('../services/roles');
const { HttpError } = require('../errors');

// GITHUB_ADMIN_ID / GITLAB_ADMIN_ID hold numeric platform user IDs, never logins: a login can
// be renamed and then claimed by someone else, an ID cannot. These users become owners.
function isConfiguredOwner(platform, id) {
  return config[platform].adminIds.includes(String(id));
}

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

// The caller's whitelisted account, or null. A configured owner ID is whitelisted, and made an
// owner, on first sign-in.
async function findAccount(caller) {
  const where = { type_id: { type: caller.platform, id: caller.id } };
  const account = await prisma.account.findUnique({ where });
  if (isConfiguredOwner(caller.platform, caller.id) && (!account || account.role !== OWNER)) {
    return prisma.account.upsert({
      where,
      create: { type: caller.platform, id: caller.id, role: OWNER },
      update: { role: OWNER },
    });
  }
  return account;
}

// Signs a request in with the caller's own GitHub or GitLab token. The caller must also be
// whitelisted by hand, unless their ID is a configured owner.
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

module.exports = { userAuth, platformCaller, findAccount, isConfiguredOwner };
