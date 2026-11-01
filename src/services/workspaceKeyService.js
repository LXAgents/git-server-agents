// Tokens the agent uses to open a development environment (a GitHub Codespace), brought by a
// repository, an org or a user like the AI keys in keyService. Zero trust: this module hands out
// key handles, not tokens. A handle's reveal() reads the row again and decrypts it at the moment
// of the call, so no plaintext token is held between calls or shared across answers.
const prisma = require('../db');
const { decrypt } = require('./cryptoService');
const { HttpError } = require('../errors');

// The workspace providers. Each one says which platform its keys belong to.
const WORKSPACE_PROVIDERS = {
  github_codespaces: { slug: 'github_codespaces', name: 'GitHub Codespaces', platform: 'github' },
};
const DEFAULT_WORKSPACE_PROVIDER = 'github_codespaces';

function findWorkspaceProvider(value) {
  const slug = String(value || DEFAULT_WORKSPACE_PROVIDER)
    .trim()
    .toLowerCase();
  return WORKSPACE_PROVIDERS[slug] || null;
}

const byPriority = [{ priority: 'desc' }, { createdAt: 'asc' }];

// Raised when nobody the caller may borrow from has a workspace key.
class NoWorkspaceKeyError extends HttpError {
  constructor(providerName) {
    super(401, `A ${providerName} token is required: add a GitHub personal access token with the codespace scope on the dashboard's API keys page`);
    this.code = 'NO_WORKSPACE_KEY';
  }
}

// Decrypts one key at the moment of use. A key switched off or deleted since it was listed is
// refused, so a revoked key stops working mid-answer.
async function revealKey(id) {
  const row = await prisma.workspaceKey.findUnique({ where: { id } });
  if (!row || !row.isActive) throw new NoWorkspaceKeyError((findWorkspaceProvider(row && row.provider) || WORKSPACE_PROVIDERS[DEFAULT_WORKSPACE_PROVIDER]).name);
  return decrypt(row.tokenEncrypted);
}

function handle(row, owner) {
  return { id: row.id, owner, priority: row.priority, provider: row.provider, reveal: () => revealKey(row.id) };
}

// Every active key for `provider`, in the order the agent tries them: the repository's, then the
// org's, then the user's own, each group by priority (highest first). Pass null for a group the
// caller may not use: the repository only for its collaborators or admins, the org only for its
// members (the caller checks both on the platform, see agent/membership). `account` is
// { type, id }, `installation` an AppInstallation row, `repository` a Repository row.
// Throws NoWorkspaceKeyError (401) when there is none.
async function getWorkspaceKeys(provider, account, installation, repository = null) {
  const known = findWorkspaceProvider(provider);
  if (!known) throw new HttpError(400, `unknown workspace provider ${provider}`);
  const where = { provider: known.slug, isActive: true };
  const rows = (owner) => (owner ? prisma.workspaceKey.findMany({ where: { ...where, ...owner }, orderBy: byPriority, select: { id: true, priority: true, provider: true } }) : []);
  const [repoRows, orgRows, userRows] = await Promise.all([
    rows(repository && { repositoryId: repository.id }),
    rows(installation && { appInstallationId: installation.id }),
    rows(account && { accountType: account.type, accountId: String(account.id) }),
  ]);
  const keys = [...repoRows.map((r) => handle(r, 'repo')), ...orgRows.map((r) => handle(r, 'org')), ...userRows.map((r) => handle(r, 'user'))];
  if (keys.length === 0) throw new NoWorkspaceKeyError(known.name);
  return keys;
}

// The same list, or [] instead of the 401: for deciding whether to offer the workspace tools.
async function findWorkspaceKeys(provider, account, installation, repository = null) {
  try {
    return await getWorkspaceKeys(provider, account, installation, repository);
  } catch (err) {
    if (err instanceof NoWorkspaceKeyError) return [];
    throw err;
  }
}

module.exports = {
  WORKSPACE_PROVIDERS,
  DEFAULT_WORKSPACE_PROVIDER,
  findWorkspaceProvider,
  getWorkspaceKeys,
  findWorkspaceKeys,
  revealKey,
  NoWorkspaceKeyError,
};
