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
    // What "@agents" uses when no repo, org or user model is set.
    defaultModel: process.env.DEFAULT_MODEL || 'openrouter/free',
    // Where the dashboard's model list comes from.
    openRouterUrl: trimSlash(process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'),
    providerName: 'OpenRouter',
    maxDiffChars: Number(process.env.MAX_DIFF_CHARS) || 100000,
  },
  worker: {
    inline: process.env.WORKER_INLINE !== 'false',
    pollMs: Number(process.env.WORKER_POLL_MS) || 5000,
  },
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};
