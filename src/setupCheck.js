const config = require('./config');
const prisma = require('./db');
const logs = require('./services/logService');

// Settings that make the server refuse or ignore every webhook without saying so at the time.
// Returns the warnings; `run` logs them at start.
function secretWarnings(cfg = config) {
  if (!cfg.isProd) return [];
  const platforms = [
    ['GitHub', cfg.github.clientId || cfg.github.privateKey, cfg.github.webhookSecret, 'GITHUB_WEBHOOK_SECRET'],
    ['GitLab', cfg.gitlab.token || cfg.gitlab.clientId, cfg.gitlab.webhookSecret, 'GITLAB_WEBHOOK_SECRET'],
  ];
  return platforms
    .filter(([, configured, secret]) => configured && !secret)
    .map(([name, , , envName]) => `${envName} is not set: PROD=prod answers every ${name} webhook with 401`);
}

async function orgWarnings(db = prisma) {
  const imported = await db.appInstallation.count();
  if (imported) return [];
  return ['no organization is imported in this database yet: webhooks get 403 until one is imported from the dashboard'];
}

async function run({ cfg = config, db = prisma, log = logs } = {}) {
  log.info('setup', `database: ${cfg.isProd ? 'PostgreSQL (PROD=prod)' : 'SQLite (prisma/dev.db)'}`);
  let warnings = secretWarnings(cfg);
  try {
    warnings = warnings.concat(await orgWarnings(db));
  } catch (err) {
    warnings.push(`could not read the database: ${err.message}`);
  }
  for (const warning of warnings) log.warn('setup', warning);
  return warnings;
}

module.exports = { run, secretWarnings, orgWarnings };
