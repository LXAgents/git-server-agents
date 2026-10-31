require('dotenv').config({ quiet: true });

const isProd = process.env.PROD === 'prod';

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    appId: process.env.GITHUB_APP_ID || '',
    // Accept a PEM with literal "\n" sequences so it fits on one .env line.
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
  },
  gitlab: {
    webhookSecret: process.env.GITLAB_WEBHOOK_SECRET || '',
    token: process.env.GITLAB_TOKEN || '',
    apiUrl: process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4',
  },
  ai: {
    defaultModel: process.env.DEFAULT_MODEL || 'openrouter/auto',
    providerName: 'OpenRouter',
    maxDiffChars: Number(process.env.MAX_DIFF_CHARS) || 100000,
  },
  worker: {
    inline: process.env.WORKER_INLINE !== 'false',
    pollMs: Number(process.env.WORKER_POLL_MS) || 5000,
  },
  encryptionKey: process.env.ENCRYPTION_KEY || '',
};
