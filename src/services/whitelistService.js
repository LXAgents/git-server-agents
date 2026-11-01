const prisma = require('../db');

// The apps are public, so an event is only acted on in an org (or personal account) that its
// owner imported through the dashboard, and only for that org's own App installation. Who
// commented is not checked here: anyone can log in with GitHub or GitLab. Which AI keys
// a commenter may use is decided per comment (see keyService and agentService).
async function verify(platform, identity) {
  const { triggerUserId, targetOrg, installationId } = identity;
  if (!triggerUserId || !targetOrg) {
    return { allowed: false, reason: 'missing user or org in payload' };
  }

  const installation = await prisma.appInstallation.findUnique({
    where: { platform_orgName: { platform, orgName: targetOrg } },
  });
  if (!installation) {
    return { allowed: false, reason: `org ${targetOrg} is not imported` };
  }
  if (installation.installationId && installationId && installation.installationId !== installationId) {
    return { allowed: false, reason: `installation ${installationId} does not match org ${targetOrg}` };
  }

  const account = await prisma.account.findUnique({
    where: { type_id: { type: platform, id: triggerUserId } },
  });
  return { allowed: true, installation, account };
}

module.exports = { verify };
