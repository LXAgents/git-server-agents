require('dotenv').config({ quiet: true });
const path = require('path');

const isProd = process.env.PROD === 'prod';

// PostgreSQL reads DATABASE_URL; SQLite always uses prisma/dev.db, whatever the working directory.
const databaseUrl = isProd
  ? process.env.DATABASE_URL || ''
  : `file:${path.join(__dirname, '..', 'prisma', 'dev.db')}`;

const { trimTrailingSlashes: trimSlash } = require('./utils/strings');
// Each platform has at most one owner: the single numeric user ID in GITHUB_ADMIN_ID or
// GITLAB_ADMIN_ID. A list is refused at start rather than silently cut down to one.
function ownerId(name) {
  const ids = String(process.env[name] || '').split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length > 1) throw new Error(`${name} must be one numeric user ID: a platform has only one owner`);
  return ids[0] || '';
}
const gitlabApiUrl = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';

module.exports = {
  isProd,
  databaseUrl,
  port: Number(process.env.PORT) || 3000,
  // This server's public address, for OAuth callback URLs. Empty means the request's own host.
  publicUrl: trimSlash(process.env.PUBLIC_URL || ''),
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    // The GitHub App's client ID: the JWT issuer for installation tokens and the OAuth client.
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    // Accept a PEM with literal "\n" sequences so it fits on one .env line.
    privateKey: (process.env.GITHUB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    webUrl: trimSlash(process.env.GITHUB_URL || 'https://github.com'),
    // The GitHub owner's numeric user ID, or '' for no owner.
    ownerId: ownerId('GITHUB_ADMIN_ID'),
  },
  gitlab: {
    webhookSecret: process.env.GITLAB_WEBHOOK_SECRET || '',
    token: process.env.GITLAB_TOKEN || '',
    clientId: process.env.GITLAB_CLIENT_ID || '',
    clientSecret: process.env.GITLAB_CLIENT_SECRET || '',
    apiUrl: gitlabApiUrl,
    webUrl: trimSlash(process.env.GITLAB_URL || gitlabApiUrl.replace(/\/api\/v4\/?$/, '')),
    // The GitLab owner's numeric user ID, or '' for no owner.
    ownerId: ownerId('GITLAB_ADMIN_ID'),
  },
  ai: {
    // What "@lxagents" uses when no repo, org or user model is set. The server has no key of its
    // own for any provider: the commenter, org or repo still needs a key for this provider.
    defaultProvider: String(process.env.DEFAULT_PROVIDER || 'openrouter').toLowerCase(),
    defaultModel: process.env.DEFAULT_MODEL || 'openrouter/free',
    // Each provider's API base URL; the seed stores them in the Provider table.
    openRouterUrl: trimSlash(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'),
    openAiUrl: trimSlash(process.env.OPENAI_API_URL || 'https://api.openai.com/v1'),
    anthropicUrl: trimSlash(process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'),
    deepSeekUrl: trimSlash(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com'),
    // https://open.bigmodel.cn/api/paas/v4 for the mainland China endpoint.
    zaiUrl: trimSlash(process.env.ZAI_API_URL || 'https://api.z.ai/api/paas/v4'),
    // The longest answer a provider may write (Anthropic requires a limit on every call).
    maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS) || 16000,
    maxDiffChars: Number(process.env.MAX_DIFF_CHARS) || 100000,
    // One model call, and one whole answer (every call, tool and key together).
    modelTimeoutMs: Number(process.env.MODEL_TIMEOUT_MS) || 60_000,
    taskTimeoutMs: Number(process.env.TASK_TIMEOUT_MS) || 240_000,
  },
  worker: {
    inline: process.env.WORKER_INLINE !== 'false',
    pollMs: Number(process.env.WORKER_POLL_MS) || 5000,
    // How many comments are answered at the same time.
    concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4),
  },
  logs: {
    // Log lines are also stored for the dashboard's Logs page, and deleted after this many days.
    store: process.env.LOG_STORE !== 'false',
    retentionDays: Math.max(1, Number(process.env.LOG_RETENTION_DAYS) || 14),
  },
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
