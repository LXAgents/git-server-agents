// Stored API keys as the admin and user APIs see them. The plaintext key never leaves
// this module: views carry only its last four characters.
const prisma = require('../db');
const { encrypt, decrypt } = require('./cryptoService');
const { HttpError } = require('../errors');

const include = { provider: true, appInstallation: true, account: true };

function last4(row) {
  try {
    return decrypt(row.apiKeyEncrypted).slice(-4);
  } catch {
    return null;
  }
}

function toView(row) {
  const owner = row.appInstallation
    ? { type: 'org', id: row.appInstallation.id, platform: row.appInstallation.platform, name: row.appInstallation.orgName }
    : { type: 'user', id: row.accountId, platform: row.accountType, name: (row.account && row.account.username) || row.accountId };
  return {
    id: row.id,
    owner,
    provider: row.provider.displayName,
    priority: row.priority,
    isActive: row.isActive,
    last4: last4(row),
    createdAt: row.createdAt,
  };
}

async function listKeys(where = {}) {
  const rows = await prisma.accountKey.findMany({ where, include, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });
  return rows.map(toView);
}

// `owner` is { accountType, accountId } or { appInstallationId }.
async function createKey(owner, { apiKey, priority, provider = 'OpenRouter' }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new HttpError(400, 'apiKey is required');
  const providerRow = await prisma.provider.findFirst({ where: { displayName: provider } });
  if (!providerRow) throw new HttpError(400, `unknown provider ${provider}`);
  const row = await prisma.accountKey.create({
    data: {
      ...owner,
      providerId: providerRow.id,
      apiKeyEncrypted: encrypt(apiKey.trim()),
      priority: Number.isInteger(Number(priority)) ? Number(priority) : 0,
    },
    include,
  });
  return toView(row);
}

async function deleteKey(where) {
  const { count } = await prisma.accountKey.deleteMany({ where });
  if (count === 0) throw new HttpError(404, 'key not found');
}

module.exports = { listKeys, createKey, deleteKey };
