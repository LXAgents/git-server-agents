const prisma = require('../db');
const { decrypt } = require('./cryptoService');
const log = require('./logService');
const { findProvider } = require('./providers');

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

// The Provider row for a slug or display name ("openai", "OpenAI"), or null. Rows seeded
// before 1.13.0 have no slug, so the display name is tried too.
async function findProviderRow(value) {
  const known = findProvider(value);
  if (!known) return null;
  return (
    (await prisma.provider.findFirst({ where: { slug: known.slug } })) ||
    (await prisma.provider.findFirst({ where: { displayName: known.name } }))
  );
}

// Every active, decrypted key for the provider, in the order the agent tries them: the repo's
// keys, then the org's, then the user's own, each group by priority, highest first. Pass null
// for a group the commenter may not use. `provider` is a slug ("anthropic") or display name,
// `account` is { type, id }, `appInstallation` an AppInstallation row and `repository` a
// Repository row. The server has no key of its own: an empty list means nobody brought one.
async function getProviderKeys(providerSlug, account, appInstallation, repository = null) {
  const provider = await findProviderRow(providerSlug);
  if (!provider) throw new Error(`provider ${providerSlug} is not configured; run npm run db:seed`);

  const where = { providerId: provider.id, isActive: true };
  const rows = (owner) => (owner ? prisma.accountKey.findMany({ where: { ...where, ...owner }, orderBy: byPriority }) : []);
  const repoRows = await rows(repository && { repositoryId: repository.id });
  const orgRows = await rows(appInstallation && { appInstallationId: appInstallation.id });
  const userRows = await rows(account && { accountType: account.type, accountId: account.id });

  return { provider, keys: [...decryptAll(repoRows, 'repo'), ...decryptAll(orgRows, 'org'), ...decryptAll(userRows, 'user')] };
}

// The first usable key for the provider among `owners` (where-fragments, tried in order), for
// listing a provider's models with a key the caller brought. Null when there is none.
async function firstKey(providerSlug, owners) {
  const provider = await findProviderRow(providerSlug);
  if (!provider) return null;
  for (const owner of owners) {
    if (!owner) continue;
    const rows = await prisma.accountKey.findMany({ where: { ...owner, providerId: provider.id, isActive: true }, orderBy: byPriority });
    const [key] = decryptAll(rows, 'list');
    if (key) return key.apiKey;
  }
  return null;
}

module.exports = { getProviderKeys, findProviderRow, firstKey };
