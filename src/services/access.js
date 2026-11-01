// Live ownership checks for a signed-in user. Every org or repository request asks the
// platform again: the answer is never stored.
const prisma = require('../db');
const platforms = require('./platformService');
const { HttpError } = require('../errors');

// The imported org `id`, if `user` owns it on its platform right now: 404 if unknown, 403 if not theirs.
async function requireOrgOwner(user, id) {
  const org = await prisma.appInstallation.findUnique({ where: { id: String(id) } });
  if (!org || org.platform !== user.platform) throw new HttpError(404, 'org not found');
  const owner = await platforms.isOwner(user.platform, user.token, user, org.orgName);
  if (!owner) throw new HttpError(403, `you are not an owner of ${org.orgName}`);
  return org;
}

// The imported repository `id`, if `user` administers it right now: 404 if unknown, 403 if not.
async function requireRepoAdmin(user, id) {
  const repo = await prisma.repository.findUnique({ where: { id: String(id) } });
  if (!repo || repo.platform !== user.platform) throw new HttpError(404, 'repository not found');
  const admin = await platforms.isRepoAdmin(user.platform, user.token, user, repo);
  if (!admin) throw new HttpError(403, `you do not administer ${repo.fullName}`);
  return repo;
}

module.exports = { requireOrgOwner, requireRepoAdmin };
