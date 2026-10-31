// Operator endpoints. Whitelisting users happens only here; orgs are never created here,
// because they come in by import (see userController).
const prisma = require('../db');
const keyStore = require('../services/keyStore');
const { PLATFORMS } = require('../services/platformService');
const { HttpError } = require('../errors');

function platformParam(value) {
  if (!PLATFORMS.includes(value)) throw new HttpError(400, 'platform must be github or gitlab');
  return value;
}

function requiredString(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') throw new HttpError(400, `${name} is required`);
  return String(value).trim();
}

async function listAccounts(_req, res) {
  const rows = await prisma.account.findMany({
    include: { _count: { select: { keys: true, installations: true } } },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(
    rows.map((a) => ({
      platform: a.type,
      id: a.id,
      username: a.username,
      keyCount: a._count.keys,
      orgCount: a._count.installations,
      createdAt: a.createdAt,
    }))
  );
}

async function createAccount(req, res) {
  const { platform, userId, username } = req.body || {};
  const account = await prisma.account.create({
    data: {
      type: platformParam(platform),
      id: requiredString(userId, 'userId'),
      username: username ? String(username).trim() : null,
    },
  });
  res.status(201).json({ platform: account.type, id: account.id, username: account.username, createdAt: account.createdAt });
}

// Cascades to the orgs this account owns and to their keys.
async function deleteAccount(req, res) {
  await prisma.account.delete({ where: { type_id: { type: platformParam(req.params.platform), id: req.params.userId } } });
  res.sendStatus(204);
}

async function listOrgs(_req, res) {
  const rows = await prisma.appInstallation.findMany({
    include: { account: true, models: true, _count: { select: { keys: true } } },
    orderBy: [{ platform: 'asc' }, { orgName: 'asc' }],
  });
  res.json(rows.map(orgView));
}

function orgView(o) {
  return {
    id: o.id,
    platform: o.platform,
    orgName: o.orgName,
    installationId: o.installationId,
    owner: { platform: o.accountType, id: o.accountId, username: o.account ? o.account.username : null },
    keyCount: o._count ? o._count.keys : undefined,
    models: o.models ? Object.fromEntries(o.models.map((m) => [m.modality, m.model])) : undefined,
    createdAt: o.createdAt,
  };
}

async function deleteOrg(req, res) {
  await prisma.appInstallation.delete({ where: { id: req.params.id } });
  res.sendStatus(204);
}

async function listKeys(_req, res) {
  res.json(await keyStore.listKeys());
}

async function createKey(req, res) {
  const body = req.body || {};
  let owner;
  if (body.target === 'user') {
    const accountType = platformParam(body.platform);
    const accountId = requiredString(body.userId, 'userId');
    const account = await prisma.account.findUnique({ where: { type_id: { type: accountType, id: accountId } } });
    if (!account) throw new HttpError(400, `${accountType} user ${accountId} is not whitelisted`);
    owner = { accountType, accountId };
  } else if (body.target === 'org') {
    const appInstallationId = requiredString(body.appInstallationId, 'appInstallationId');
    const org = await prisma.appInstallation.findUnique({ where: { id: appInstallationId } });
    if (!org) throw new HttpError(400, `org ${appInstallationId} does not exist`);
    owner = { appInstallationId };
  } else {
    throw new HttpError(400, 'target must be user or org');
  }
  res.status(201).json(await keyStore.createKey(owner, body));
}

async function deleteKey(req, res) {
  await keyStore.deleteKey({ id: req.params.id });
  res.sendStatus(204);
}

module.exports = {
  listAccounts,
  createAccount,
  deleteAccount,
  listOrgs,
  deleteOrg,
  listKeys,
  createKey,
  deleteKey,
  orgView,
  platformParam,
  requiredString,
};
