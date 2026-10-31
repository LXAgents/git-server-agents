const config = require('../config');
const prisma = require('../db');
const platforms = require('../services/platformService');
const { HttpError } = require('../errors');

// GITHUB_ADMIN_ID / GITLAB_ADMIN_ID hold numeric platform user IDs, never logins: a login can
// be renamed and then claimed by someone else, an ID cannot.
function isPlatformAdmin(platform, id) {
  return config[platform].adminIds.includes(String(id));
}

// Who the caller is on the platform, from their own token:
//   X-Platform: github | gitlab
//   Authorization: Bearer <OAuth or personal access token>
async function platformCaller(req) {
  const platform = String(req.get('x-platform') || '').toLowerCase();
  if (!platforms.PLATFORMS.includes(platform)) throw new HttpError(400, 'X-Platform must be github or gitlab');
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) throw new HttpError(401, 'missing bearer token');
  const token = match[1].trim();
  const user = await platforms.getUser(platform, token);
  return { ...user, token, isAdmin: isPlatformAdmin(platform, user.id) };
}

// Signs a request in with the caller's own GitHub or GitLab token. The caller must also be
// whitelisted by hand; an admin user is whitelisted on first sign-in.
async function userAuth(req, _res, next) {
  try {
    const caller = await platformCaller(req);
    const where = { type_id: { type: caller.platform, id: caller.id } };
    let account = await prisma.account.findUnique({ where });
    if (!account && caller.isAdmin) {
      account = await prisma.account.upsert({
        where,
        create: { type: caller.platform, id: caller.id, username: caller.login },
        update: {},
      });
    }
    if (!account) throw new HttpError(403, 'user is not whitelisted');

    req.user = { ...caller, account };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { userAuth, platformCaller, isPlatformAdmin };
