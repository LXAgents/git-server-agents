// The start-up check warns about settings that silently refuse every webhook.
const test = require('node:test');
const assert = require('node:assert/strict');
const { secretWarnings, orgWarnings, run } = require('../src/setupCheck');

const cfg = (isProd, github = {}, gitlab = {}) => ({ isProd, github, gitlab });

test('warns under PROD=prod when an App is set up without its webhook secret', () => {
  assert.deepEqual(secretWarnings(cfg(true, { clientId: 'Iv1' }, { token: 'glpat' })), [
    'GITHUB_WEBHOOK_SECRET is not set: PROD=prod answers every GitHub webhook with 401',
    'GITLAB_WEBHOOK_SECRET is not set: PROD=prod answers every GitLab webhook with 401',
  ]);
});

test('is quiet with the secrets set, with no App set up, or outside PROD=prod', () => {
  assert.deepEqual(secretWarnings(cfg(true, { clientId: 'Iv1', webhookSecret: 's' }, { token: 't', webhookSecret: 's' })), []);
  assert.deepEqual(secretWarnings(cfg(true)), []);
  assert.deepEqual(secretWarnings(cfg(false, { clientId: 'Iv1' })), []);
});

test('warns when the database has no imported organization', async () => {
  const db = (n) => ({ appInstallation: { count: async () => n } });
  assert.match((await orgWarnings(db(0)))[0], /no organization is imported/);
  assert.deepEqual(await orgWarnings(db(2)), []);
});

test('logs the database and every warning, and survives a database error', async () => {
  const lines = [];
  const log = { log: (l) => lines.push(l), warn: (l) => lines.push(l) };
  const db = { appInstallation: { count: async () => { throw new Error('connection refused'); } } };
  const warnings = await run({ cfg: cfg(true, { clientId: 'Iv1' }), db, log });
  assert.equal(warnings.length, 2);
  assert.equal(lines[0], '[setup] database: PostgreSQL (PROD=prod)');
  assert.match(lines[2], /could not read the database: connection refused/);
});
