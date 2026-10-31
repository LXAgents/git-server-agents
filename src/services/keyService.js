const prisma = require('../db');
const { decrypt } = require('./cryptoService');

const byPriority = [{ priority: 'desc' }, { createdAt: 'asc' }];

function decryptAll(rows, owner) {
  const keys = [];
  for (const row of rows) {
    try {
      keys.push({ id: row.id, owner, priority: row.priority, apiKey: decrypt(row.apiKeyEncrypted) });
    } catch (err) {
      // One unreadable row (e.g. stored under an old ENCRYPTION_KEY) should not hide the rest.
      console.warn(`[keys] skipping key ${row.id}: ${err.message}`);
    }
  }
  return keys;
}

// Every active, decrypted key for the provider: the user's keys first, then the org's,
// each group by priority, highest first. `account` is { type, id } and `appInstallation`
// an AppInstallation row; either may be null.
async function getProviderKeys(providerName, account, appInstallation) {
  const provider = await prisma.provider.findFirst({ where: { displayName: providerName } });
  if (!provider) throw new Error(`provider ${providerName} is not configured; run npm run db:seed`);

  const where = { providerId: provider.id, isActive: true };
  const userRows = account
    ? await prisma.accountKey.findMany({
        where: { ...where, accountType: account.type, accountId: account.id },
        orderBy: byPriority,
      })
    : [];
  const orgRows = appInstallation
    ? await prisma.accountKey.findMany({ where: { ...where, appInstallationId: appInstallation.id }, orderBy: byPriority })
    : [];

  return { provider, keys: [...decryptAll(userRows, 'user'), ...decryptAll(orgRows, 'org')] };
}

module.exports = { getProviderKeys };
