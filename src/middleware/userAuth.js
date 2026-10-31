const platforms = require('../services/platformService');
const profiles = require('../services/profileService');
const owners = require('../services/ownerService');
const { HttpError } = require('../errors');

// Personal access tokens never expire and carry whatever scopes their owner gave them, so only
// the OAuth sign-in ("Continue with GitHub/GitLab") is accepted. These are the PAT prefixes
// GitHub (classic and fine-grained) and GitLab put on every token.
const PAT_PREFIXES = ['ghp_', 'github_pat_', 'glpat-'];
function isPersonalAccessToken(token) {
  return PAT_PREFIXES.some((prefix) => token.startsWith(prefix));
}

// Who the caller is on the platform, from their own OAuth token:
//   X-Platform: github | gitlab
//   Authorization: Bearer <token from Continue with GitHub/GitLab>
async function platformCaller(req) {
  const platform = String(req.get('x-platform') || '').toLowerCase();
  if (!platforms.PLATFORMS.includes(platform)) throw new HttpError(400, 'X-Platform must be github or gitlab');
  // \s+ and \S+ can't overlap, so this stays linear on any header.
  const match = /^Bearer\s+(\S+)$/i.exec(String(req.get('authorization') || '').trim());
  if (!match) throw new HttpError(401, 'missing bearer token');
  const token = match[1].trim();
  if (isPersonalAccessToken(token)) {
    throw new HttpError(401, 'personal access tokens are not accepted: sign in with GitHub or GitLab');
  }
  const user = await platforms.getUser(platform, token);
  profiles.remember(platform, user.id, user);
  return { ...user, token };
}

// The caller's account, created as free on first sign-in. The one configured owner ID is made
// owner (see ownerService).
function findAccount(caller) {
  return owners.syncAccount(caller.platform, caller.id);
}

// Signs a request in with the caller's own GitHub or GitLab token. The caller must also be
// Anyone with a GitHub or GitLab account can sign in: sign-up is open.
async function userAuth(req, _res, next) {
  try {
    const caller = await platformCaller(req);
    const account = await findAccount(caller);
    req.user = { ...caller, account, role: account.role };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { userAuth, platformCaller, findAccount, isPersonalAccessToken };
