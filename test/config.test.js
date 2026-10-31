// The owner setting holds one ID per platform.
const test = require('node:test');
const assert = require('node:assert/strict');

function loadConfig(env) {
  const saved = { GITHUB_ADMIN_ID: process.env.GITHUB_ADMIN_ID, GITLAB_ADMIN_ID: process.env.GITLAB_ADMIN_ID };
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../src/config')];
  try {
    return require('../src/config');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../src/config')];
  }
}

test('each platform takes one owner ID, or none', () => {
  const config = loadConfig({ GITHUB_ADMIN_ID: ' 42 ', GITLAB_ADMIN_ID: '' });
  assert.equal(config.github.ownerId, '42');
  assert.equal(config.gitlab.ownerId, '');
});

test('a list of owner IDs is refused at start', () => {
  assert.throws(() => loadConfig({ GITHUB_ADMIN_ID: '1,2' }), /GITHUB_ADMIN_ID must be one numeric user ID/);
  assert.throws(() => loadConfig({ GITLAB_ADMIN_ID: '7, 8' }), /GITLAB_ADMIN_ID must be one numeric user ID/);
});
