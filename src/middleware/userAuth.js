const prisma = require('../db');
const platforms = require('../services/platformService');
const { HttpError } = require('../errors');

// Signs a request in with the caller's own GitHub or GitLab token:
//   X-Platform: github | gitlab
//   Authorization: Bearer <personal access token>
// The platform says who the caller is; the caller must also be whitelisted by hand.
async function userAuth(req, _res, next) {
  try {
    const platform = String(req.get('x-platform') || '').toLowerCase();
    if (!platforms.PLATFORMS.includes(platform)) throw new HttpError(400, 'X-Platform must be github or gitlab');
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) throw new HttpError(401, 'missing bearer token');

    const token = match[1].trim();
    const user = await platforms.getUser(platform, token);
    const account = await prisma.account.findUnique({ where: { type_id: { type: platform, id: user.id } } });
    if (!account) throw new HttpError(403, 'user is not whitelisted');

    req.user = { ...user, token, account };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { userAuth };
