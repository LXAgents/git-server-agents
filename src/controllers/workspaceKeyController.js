// Workspace keys (GitHub Codespaces tokens) for signed-in users: their own, an org's they own and
// a repository's they administer. Org and repository ownership is asked of the platform on
// every call, never stored.
const store = require('../services/workspaceKeyStore');
const access = require('../services/access');
const { nameUserOwners } = require('../services/views');

function ownKeys(user) {
  return { accountType: user.platform, accountId: user.id };
}

async function listOwn(req, res) {
  res.json(await nameUserOwners(await store.listWorkspaceKeys(ownKeys(req.user)), req.user.platform, req.user.token));
}

async function createOwn(req, res) {
  const view = await store.createWorkspaceKey(ownKeys(req.user), req.user.platform, req.body || {});
  const [named] = await nameUserOwners([view], req.user.platform, req.user.token);
  res.status(201).json(named);
}

async function deleteOwn(req, res) {
  await store.deleteWorkspaceKey({ id: req.params.keyId, ...ownKeys(req.user) });
  res.sendStatus(204);
}

async function listOrg(req, res) {
  const org = await access.requireOrgOwner(req.user, req.params.id);
  res.json(await store.listWorkspaceKeys({ appInstallationId: org.id }));
}

async function createOrg(req, res) {
  const org = await access.requireOrgOwner(req.user, req.params.id);
  res.status(201).json(await store.createWorkspaceKey({ appInstallationId: org.id }, org.platform, req.body || {}));
}

async function deleteOrg(req, res) {
  const org = await access.requireOrgOwner(req.user, req.params.id);
  await store.deleteWorkspaceKey({ id: req.params.keyId, appInstallationId: org.id });
  res.sendStatus(204);
}

async function listRepo(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.json(await store.listWorkspaceKeys({ repositoryId: repo.id }));
}

async function createRepo(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  res.status(201).json(await store.createWorkspaceKey({ repositoryId: repo.id }, repo.platform, req.body || {}));
}

async function deleteRepo(req, res) {
  const repo = await access.requireRepoAdmin(req.user, req.params.id);
  await store.deleteWorkspaceKey({ id: req.params.keyId, repositoryId: repo.id });
  res.sendStatus(204);
}

module.exports = { listOwn, createOwn, deleteOwn, listOrg, createOrg, deleteOrg, listRepo, createRepo, deleteRepo };
