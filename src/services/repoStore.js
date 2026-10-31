// Imported repositories (GitHub) and projects (GitLab), as the agent and the APIs see them.
const prisma = require('../db');

// The repository a webhook event came from, if one of its admins added it, and only when it
// sits in the org the event was whitelisted under.
async function findForEvent(platform, payload, installation) {
  const raw = platform === 'github' ? payload.repository && payload.repository.id : payload.project && payload.project.id;
  if (raw === undefined || raw === null || !installation) return null;
  const repo = await prisma.repository.findUnique({ where: { platform_externalId: { platform, externalId: String(raw) } } });
  return repo && repo.appInstallationId === installation.id ? repo : null;
}

function repoView(r) {
  return {
    id: r.id,
    platform: r.platform,
    externalId: r.externalId,
    fullName: r.fullName,
    org: r.appInstallation ? { id: r.appInstallation.id, name: r.appInstallation.orgName } : { id: r.appInstallationId, name: null },
    keyCount: r._count ? r._count.keys : undefined,
    models: r.models ? Object.fromEntries(r.models.map((m) => [m.modality, m.model])) : undefined,
    createdAt: r.createdAt,
  };
}

const viewInclude = { appInstallation: true, models: true, _count: { select: { keys: true } } };

module.exports = { findForEvent, repoView, viewInclude };
