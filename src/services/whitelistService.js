const prisma = require('../db');

// Zero trust: the apps are public, so every event is rejected unless both the org and the
// user that triggered it were added to the database by hand.
// Users are matched on their immutable platform id, not their login, because a login can be
// renamed and then claimed by someone else.
async function verify(platform, identity) {
  const { triggerUserId, targetOrg, installationId } = identity;
  if (!triggerUserId || !targetOrg) {
    return { allowed: false, reason: 'missing user or org in payload' };
  }

  const installation = await prisma.appInstallation.findUnique({
    where: { platform_orgName: { platform, orgName: targetOrg } },
  });
  if (!installation) {
    return { allowed: false, reason: `org ${targetOrg} is not whitelisted` };
  }
  if (installation.installationId && installationId && installation.installationId !== installationId) {
    return { allowed: false, reason: `installation ${installationId} does not match org ${targetOrg}` };
  }

  const account = await prisma.account.findUnique({
    where: { type_id: { type: platform, id: triggerUserId } },
  });
  if (!account) {
    return { allowed: false, reason: `user ${identity.triggerUser || triggerUserId} is not whitelisted` };
  }

  return { allowed: true, installation, account };
}

module.exports = { verify };
