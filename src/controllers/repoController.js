// Repositories (GitHub) and projects (GitLab) for signed-in users. Like orgs, a repo is never
// typed in: it is imported from the repos the platform says the user administers, and every
// change asks the platform again whether the user still administers it.
const prisma = require('../db');
const keyStore = require('../services/keyStore');
const models = require('../services/modelService');
const platforms = require('../services/platformService');
const { repoView, viewInclude } = require('../services/repoStore');
const access = require('../services/access');
const { HttpError } = require('../errors');

const lower = (s) => String(s).toLowerCase();

async function importedOrgs(platform) {
  const orgs = await prisma.appInstallation.findMany({ where: { platform } });
  return new Map(orgs.map((o) => [lower(o.orgName), o]));
}

// Imported repos the user administers right now.
async function listRepos(req, res) {
  const { platform } = req.user;
  const admin = new Set((await platforms.listAdminRepos(platform, req.user.token)).map((r) => r.externalId));
  const rows = await prisma.repository.findMany({ where: { platform }, include: viewInclude, orderBy: { fullName: 'asc' } });
  res.json(rows.filter((r) => admin.has(r.externalId)).map(repoView));
}

// Repos the user administers, and whether each can be imported.
async function listImportable(req, res) {
  const { platform } = req.user;
  const [repos, orgs, imported] = await Promise.all([
    platforms.listAdminRepos(platform, req.user.token),
    importedOrgs(platform),
    prisma.repository.findMany({ where: { platform } }),
  ]);
  const importedIds = new Set(imported.map((r) => r.externalId));
  res.json(
    repos.map((r) => {
      let reason = null;
      if (importedIds.has(r.externalId)) reason = 'already imported';
      else if (!orgs.has(lower(r.org))) reason = 'organization not imported';
      return { externalId: r.externalId, fullName: r.fullName, org: r.org, importable: !reason, reason };
    })
  );
}

async function importRepo(req, res) {
  const { platform } = req.user;
  const externalId = String((req.body && req.body.externalId) || '').trim();
  if (!externalId) throw new HttpError(400, 'externalId is required');

  const repo = (await platforms.listAdminRepos(platform, req.user.token)).find((r) => r.externalId === externalId);
  if (!repo) throw new HttpError(403, `you do not administer repository ${externalId} on ${platform}`);
  const org = (await importedOrgs(platform)).get(lower(repo.org));
  if (!org) throw new HttpError(400, `import the organization ${repo.org} first`);

  const created = await prisma.repository.create({
    data: { platform, externalId, fullName: repo.fullName, appInstallationId: org.id },
    include: viewInclude,
  });
  res.status(201).json(repoView(created));
}

async function deleteRepo(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  await prisma.repository.delete({ where: { id: repo.id } });
  res.sendStatus(204);
}

async function listRepoKeys(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.json(await keyStore.listKeys({ repositoryId: repo.id }));
}

async function createRepoKey(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.status(201).json(await keyStore.createKey({ repositoryId: repo.id }, req.body || {}));
}

async function deleteRepoKey(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  await keyStore.deleteKey({ id: req.params.keyId, repositoryId: repo.id });
  res.sendStatus(204);
}

async function getRepoModels(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.json(await models.getModels({ repositoryId: repo.id }));
}

async function setRepoModel(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.json(await models.setModel({ repositoryId: repo.id }, req.body || {}));
}

module.exports = {
  listRepos,
  listImportable,
  importRepo,
  deleteRepo,
  listRepoKeys,
  createRepoKey,
  deleteRepoKey,
  getRepoModels,
  setRepoModel,
};
