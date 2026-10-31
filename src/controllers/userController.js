// Endpoints for a signed-in, whitelisted user (see middleware/userAuth). Users manage their
// own keys freely. Anything that changes or reveals an org asks the platform, every time,
// whether the user owns that org; the answer is never stored.
const prisma = require('../db');
const keyStore = require('../services/keyStore');
const platforms = require('../services/platformService');
const { orgView } = require('./adminController');
const { HttpError } = require('../errors');

const lower = (s) => String(s).toLowerCase();

function me(req, res) {
  const { platform, id, login, account } = req.user;
  res.json({ platform, id, login, username: account.username });
}

function ownKeys(user) {
  return { accountType: user.platform, accountId: user.id };
}

async function listOwnKeys(req, res) {
  res.json(await keyStore.listKeys(ownKeys(req.user)));
}

async function createOwnKey(req, res) {
  res.status(201).json(await keyStore.createKey(ownKeys(req.user), req.body || {}));
}

async function deleteOwnKey(req, res) {
  await keyStore.deleteKey({ id: req.params.keyId, ...ownKeys(req.user) });
  res.sendStatus(204);
}

async function ownedOnPlatform(user) {
  return platforms.listOwnedOrgs(user.platform, user.token, user);
}

// Imported orgs the user owns right now.
async function listOrgs(req, res) {
  const owned = new Set((await ownedOnPlatform(req.user)).map((o) => lower(o.name)));
  const rows = await prisma.appInstallation.findMany({
    where: { platform: req.user.platform },
    include: { account: true, _count: { select: { keys: true } } },
    orderBy: { orgName: 'asc' },
  });
  res.json(rows.filter((o) => owned.has(lower(o.orgName))).map(orgView));
}

// Orgs the user owns on the platform, and whether each can be imported.
async function listImportable(req, res) {
  const { platform } = req.user;
  const owned = await ownedOnPlatform(req.user);
  const imported = await prisma.appInstallation.findMany({ where: { platform } });
  const byName = new Map(imported.map((o) => [lower(o.orgName), o]));

  const result = [];
  for (const org of owned) {
    const existing = byName.get(lower(org.name));
    const installationId = platform === 'github' && !existing ? await platforms.findGithubInstallation(org.name, org.kind) : null;
    let reason = null;
    if (existing) reason = 'already imported';
    else if (platform === 'github' && !installationId) reason = 'GitHub App is not installed';
    result.push({ name: org.name, kind: org.kind, importable: !reason, reason, appInstallationId: existing ? existing.id : null });
  }
  res.json(result);
}

// The only way an org gets created.
async function importOrg(req, res) {
  const { platform } = req.user;
  const orgName = String((req.body && req.body.orgName) || '').trim();
  if (!orgName) throw new HttpError(400, 'orgName is required');

  const org = (await ownedOnPlatform(req.user)).find((o) => lower(o.name) === lower(orgName));
  if (!org) throw new HttpError(403, `you are not an owner of ${orgName} on ${platform}`);

  let installationId = null;
  if (platform === 'github') {
    installationId = await platforms.findGithubInstallation(org.name, org.kind);
    if (!installationId) throw new HttpError(400, `the GitHub App is not installed on ${org.name}`);
  }

  const created = await prisma.appInstallation.create({
    data: { platform, orgName: org.name, installationId, accountType: platform, accountId: req.user.id },
    include: { account: true, _count: { select: { keys: true } } },
  });
  res.status(201).json(orgView(created));
}

async function requireOrgOwner(req) {
  const org = await prisma.appInstallation.findUnique({ where: { id: req.params.id } });
  if (!org || org.platform !== req.user.platform) throw new HttpError(404, 'org not found');
  const owner = await platforms.isOwner(req.user.platform, req.user.token, req.user, org.orgName);
  if (!owner) throw new HttpError(403, `you are not an owner of ${org.orgName}`);
  return org;
}

async function deleteOrg(req, res) {
  const org = await requireOrgOwner(req);
  await prisma.appInstallation.delete({ where: { id: org.id } });
  res.sendStatus(204);
}

async function listOrgKeys(req, res) {
  const org = await requireOrgOwner(req);
  res.json(await keyStore.listKeys({ appInstallationId: org.id }));
}

async function createOrgKey(req, res) {
  const org = await requireOrgOwner(req);
  res.status(201).json(await keyStore.createKey({ appInstallationId: org.id }, req.body || {}));
}

async function deleteOrgKey(req, res) {
  const org = await requireOrgOwner(req);
  await keyStore.deleteKey({ id: req.params.keyId, appInstallationId: org.id });
  res.sendStatus(204);
}

module.exports = {
  me,
  listOwnKeys,
  createOwnKey,
  deleteOwnKey,
  listOrgs,
  listImportable,
  importOrg,
  deleteOrg,
  listOrgKeys,
  createOrgKey,
  deleteOrgKey,
};
