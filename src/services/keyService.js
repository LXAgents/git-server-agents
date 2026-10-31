const prisma = require('../db');
const { decrypt } = require('./cryptoService');
const log = require('./logService');

const byPriority = [{ priority: 'desc' }, { createdAt: 'asc' }];

function decryptAll(rows, owner) {
  const keys = [];
  for (const row of rows) {
    try {
      keys.push({ id: row.id, owner, priority: row.priority, apiKey: decrypt(row.apiKeyEncrypted) });
    } catch (err) {
      // One unreadable row (e.g. stored under an old ENCRYPTION_KEY) should not hide the rest.
      log.warn('keys', `skipping key ${row.id}: ${err.message}`);
    }
  }
  return keys;
}

// Every active, decrypted key for the provider, in the order the agent tries them: the repo's
// keys, then the org's, then the user's own, each group by priority, highest first. Pass null
// for a group the commenter may not use. `account` is { type, id }, `appInstallation` an
// AppInstallation row and `repository` a Repository row.
async function getProviderKeys(providerName, account, appInstallation, repository = null) {
  const provider = await prisma.provider.findFirst({ where: { displayName: providerName } });
  if (!provider) throw new Error(`provider ${providerName} is not configured; run npm run db:seed`);

  const where = { providerId: provider.id, isActive: true };
  const rows = (owner) => (owner ? prisma.accountKey.findMany({ where: { ...where, ...owner }, orderBy: byPriority }) : []);
  const repoRows = await rows(repository && { repositoryId: repository.id });
  const orgRows = await rows(appInstallation && { appInstallationId: appInstallation.id });
  const userRows = await rows(account && { accountType: account.type, accountId: account.id });

  return { provider, keys: [...decryptAll(repoRows, 'repo'), ...decryptAll(orgRows, 'org'), ...decryptAll(userRows, 'user')] };
}

module.exports = { getProviderKeys };
