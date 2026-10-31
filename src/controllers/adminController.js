// Owner endpoints. Whitelisting users happens only here; orgs are never created
// here, because they come in by import (see userController).
// Every endpoint works on the session's platform only (req.admin.platform, see adminAuth):
// rows from the other platform are neither listed nor changed.
const prisma = require('../db');
const keyStore = require('../services/keyStore');
const profiles = require('../services/profileService');
const { repoView, viewInclude } = require('../services/repoStore');
const { PLATFORMS } = require('../services/platformService');
const owners = require('../services/ownerService');
const { FREE } = require('../services/roles');
const { HttpError } = require('../errors');

function platformParam(value) {
  if (!PLATFORMS.includes(value)) throw new HttpError(400, 'platform must be github or gitlab');
  return value;
}

function requiredString(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') throw new HttpError(400, `${name} is required`);
  return String(value).trim();
}

// Users are added as free only. The one owner per platform is set by GITHUB_ADMIN_ID or
// GITLAB_ADMIN_ID, never through the API.
function roleParam(value, platform) {
  if (value === undefined || value === null || value === '') return FREE;
  const role = String(value).trim().toLowerCase();
  if (role === FREE) return role;
  const variable = platform === 'gitlab' ? 'GITLAB_ADMIN_ID' : 'GITHUB_ADMIN_ID';
  throw new HttpError(400, `role must be ${FREE}: a platform has one owner, set by ${variable}`);
}

function accountView(a, profile) {
  return {
    platform: a.type,
    id: a.id,
    ...profiles.describe(a.id, profile),
    role: owners.effectiveRole(a.type, a),
    keyCount: a._count ? a._count.keys : undefined,
    orgCount: a._count ? a._count.installations : undefined,
    createdAt: a.createdAt,
  };
}

async function listAccounts(req, res) {
  const { platform, token } = req.admin;
  const rows = await prisma.account.findMany({
    where: { type: platform },
    include: { _count: { select: { keys: true, installations: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const found = await profiles.getProfiles(platform, rows.map((a) => a.id), token);
  res.json(rows.map((a) => accountView(a, found.get(a.id))));
}

// Whitelists a user of the session's platform by numeric ID. Their login, name and avatar
// are read from the platform, never stored.
async function createAccount(req, res) {
  const { platform, token } = req.admin;
  const { userId, role } = req.body || {};
  const account = await prisma.account.create({
    data: { type: platform, id: requiredString(userId, 'userId'), role: roleParam(role, platform) },
  });
  res.status(201).json(accountView(account, await profiles.getProfile(platform, account.id, token)));
}

// Cascades to the orgs this account owns and to their keys.
async function deleteAccount(req, res) {
  const platform = platformParam(req.params.platform);
  if (platform !== req.admin.platform) throw new HttpError(404, 'account not found');
  await prisma.account.delete({ where: { type_id: { type: platform, id: req.params.userId } } });
  res.sendStatus(204);
}

function orgView(o, ownerProfile) {
  return {
    id: o.id,
    platform: o.platform,
    orgName: o.orgName,
    installationId: o.installationId,
    owner: { platform: o.accountType, id: o.accountId, ...profiles.describe(o.accountId, ownerProfile) },
    keyCount: o._count ? o._count.keys : undefined,
    models: o.models ? Object.fromEntries(o.models.map((m) => [m.modality, m.model])) : undefined,
    createdAt: o.createdAt,
  };
}

// Org views with each importer's profile read from the platform.
async function orgViews(rows, platform, token) {
  const found = await profiles.getProfiles(platform, rows.map((o) => o.accountId), token);
  return rows.map((o) => orgView(o, found.get(String(o.accountId))));
}

async function listOrgs(req, res) {
  const { platform, token } = req.admin;
  const rows = await prisma.appInstallation.findMany({
    where: { platform },
    include: { models: true, _count: { select: { keys: true } } },
    orderBy: { orgName: 'asc' },
  });
  res.json(await orgViews(rows, platform, token));
}

async function deleteOrg(req, res) {
  const { count } = await prisma.appInstallation.deleteMany({ where: { id: req.params.id, platform: req.admin.platform } });
  if (count === 0) throw new HttpError(404, 'org not found');
  res.sendStatus(204);
}

async function listRepos(req, res) {
  const rows = await prisma.repository.findMany({ where: { platform: req.admin.platform }, include: viewInclude, orderBy: { fullName: 'asc' } });
  res.json(rows.map(repoView));
}

async function deleteRepo(req, res) {
  const { count } = await prisma.repository.deleteMany({ where: { id: req.params.id, platform: req.admin.platform } });
  if (count === 0) throw new HttpError(404, 'repository not found');
  res.sendStatus(204);
}

// Keys whose owner (user, org or repository) is on the given platform.
function onPlatform(platform) {
  return { OR: [{ accountType: platform }, { appInstallation: { platform } }, { repository: { platform } }] };
}

// Names the user owners of key views by their platform login.
async function nameUserOwners(keys, platform, token) {
  const userIds = keys.filter((k) => k.owner.type === 'user').map((k) => k.owner.id);
  const found = await profiles.getProfiles(platform, userIds, token);
  for (const key of keys) {
    if (key.owner.type === 'user') key.owner.name = profiles.describe(key.owner.id, found.get(String(key.owner.id))).login;
  }
  return keys;
}

async function listKeys(req, res) {
  const { platform, token } = req.admin;
  res.json(await nameUserOwners(await keyStore.listKeys(onPlatform(platform)), platform, token));
}

async function createKey(req, res) {
  const body = req.body || {};
  let owner;
  const { platform } = req.admin;
  if (body.target === 'user') {
    const accountType = platform;
    const accountId = requiredString(body.userId, 'userId');
    const account = await prisma.account.findUnique({ where: { type_id: { type: accountType, id: accountId } } });
    if (!account) throw new HttpError(400, `${accountType} user ${accountId} has never logged in`);
    owner = { accountType, accountId };
  } else if (body.target === 'org') {
    const appInstallationId = requiredString(body.appInstallationId, 'appInstallationId');
    const org = await prisma.appInstallation.findUnique({ where: { id: appInstallationId } });
    if (!org || org.platform !== platform) throw new HttpError(400, `org ${appInstallationId} does not exist`);
    owner = { appInstallationId };
  } else {
    throw new HttpError(400, 'target must be user or org');
  }
  const [view] = await nameUserOwners([await keyStore.createKey(owner, body)], platform, req.admin.token);
  res.status(201).json(view);
}

async function deleteKey(req, res) {
  await keyStore.deleteKey({ id: req.params.id, ...onPlatform(req.admin.platform) });
  res.sendStatus(204);
}

module.exports = {
  listAccounts,
  createAccount,
  deleteAccount,
  listOrgs,
  deleteOrg,
  listRepos,
  deleteRepo,
  listKeys,
  createKey,
  deleteKey,
  orgView,
  orgViews,
  nameUserOwners,
  platformParam,
  requiredString,
};
