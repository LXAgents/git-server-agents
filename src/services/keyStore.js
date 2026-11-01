// Stored API keys as the admin and user APIs see them. The plaintext key never leaves
// this module: views carry only its last four characters.
const prisma = require('../db');
const { encrypt, decrypt } = require('./cryptoService');
const { HttpError } = require('../errors');
const { findProvider, providerParam } = require('./ai/providers');
const { findProviderRow } = require('./keyService');

const include = { provider: true, appInstallation: true, account: true, repository: true };

function last4(row) {
  try {
    return decrypt(row.apiKeyEncrypted).slice(-4);
  } catch {
    return null;
  }
}

function ownerView(row) {
  if (row.repository) return { type: 'repo', id: row.repository.id, platform: row.repository.platform, name: row.repository.fullName };
  if (row.appInstallation) return { type: 'org', id: row.appInstallation.id, platform: row.appInstallation.platform, name: row.appInstallation.orgName };
  // The login is filled in from the platform by the caller; the ID stands in until then.
  return { type: 'user', id: row.accountId, platform: row.accountType, name: row.accountId };
}

function toView(row) {
  const owner = ownerView(row);
  return {
    id: row.id,
    owner,
    provider: row.provider.displayName,
    providerSlug: row.provider.slug || (findProvider(row.provider.displayName) || {}).slug || null,
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

// `owner` is { accountType, accountId }, { appInstallationId } or { repositoryId }. `provider` is
// a slug such as "openai" (or a display name); left out, it is OpenRouter as before 1.13.0.
async function createKey(owner, { apiKey, priority, provider } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new HttpError(400, 'apiKey is required');
  const known = providerParam(provider);
  const providerRow = await findProviderRow(known.slug);
  if (!providerRow) throw new HttpError(400, `provider ${known.slug} is not set up on the server; run npm run db:seed`);
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
