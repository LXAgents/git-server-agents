// Stored workspace keys as the user API sees them. Like keyStore, the plaintext token never
// leaves this module: views carry only its last four characters.
const prisma = require('../db');
const { encrypt, decrypt } = require('./cryptoService');
const { HttpError } = require('../errors');
const { ownerView } = require('./keyStore');
const { findWorkspaceProvider, DEFAULT_WORKSPACE_PROVIDER } = require('./workspaceKeyService');

const include = { appInstallation: true, repository: true };

function last4(row) {
  try {
    return decrypt(row.tokenEncrypted).slice(-4);
  } catch {
    return null;
  }
}

function toView(row) {
  const provider = findWorkspaceProvider(row.provider);
  return {
    id: row.id,
    owner: ownerView(row),
    provider: provider ? provider.name : row.provider,
    providerSlug: row.provider,
    priority: row.priority,
    isActive: row.isActive,
    last4: last4(row),
    createdAt: row.createdAt,
  };
}

async function listWorkspaceKeys(where = {}) {
  const rows = await prisma.workspaceKey.findMany({ where, include, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  return rows.map(toView);
}

// `owner` is { accountType, accountId }, { appInstallationId } or { repositoryId }. `platform` is
// the owner's platform: Codespaces keys belong to GitHub owners only.
async function createWorkspaceKey(owner, platform, { token, priority, provider = DEFAULT_WORKSPACE_PROVIDER } = {}) {
  const known = findWorkspaceProvider(provider);
  if (!known) throw new HttpError(400, `unknown workspace provider ${provider}`);
  if (known.platform !== platform) throw new HttpError(400, `${known.name} keys are for ${known.platform} only`);
  if (typeof token !== 'string' || !token.trim()) throw new HttpError(400, 'token is required');
  if (/\s/.test(token.trim())) throw new HttpError(400, 'token must not contain spaces');
  const row = await prisma.workspaceKey.create({
    data: {
      ...owner,
      provider: known.slug,
      tokenEncrypted: encrypt(token.trim()),
      priority: Number.isInteger(Number(priority)) ? Number(priority) : 0,
    },
    include,
  });
  return toView(row);
}

async function deleteWorkspaceKey(where) {
  const { count } = await prisma.workspaceKey.deleteMany({ where });
  if (count === 0) throw new HttpError(404, 'workspace key not found');
}

module.exports = { listWorkspaceKeys, createWorkspaceKey, deleteWorkspaceKey };
