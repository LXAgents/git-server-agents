const prisma = require('../db');
const { decrypt } = require('./cryptoService');

// Returns the provider and decrypted key for the first account in `accounts` that has an
// active key for it. Accounts are tried in order; keys by priority, highest first.
async function getProviderKey(providerName, accounts) {
  const provider = await prisma.provider.findFirst({ where: { displayName: providerName } });
  if (!provider) throw new Error(`provider ${providerName} is not configured; run npm run db:seed`);

  for (const { type, id } of accounts) {
    const key = await prisma.accountKey.findFirst({
      where: { accountType: type, accountId: id, providerId: provider.id, isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (key) return { provider, apiKey: decrypt(key.apiKeyEncrypted) };
  }
  throw new Error(`no active ${providerName} key for ${accounts.map((a) => `${a.type}:${a.id}`).join(', ')}`);
}

module.exports = { getProviderKey };
