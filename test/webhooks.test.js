// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` first.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.GITLAB_WEBHOOK_SECRET = 'test-token';

const prisma = require('../src/db');
const { createApp } = require('../src/app');

const USER_ID = 'test-user-1001';
const ORG = 'test-org-acme';
let server;
let baseUrl;

function signed(body) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex')}`;
  return { raw, signature };
}

function postGithub(body, { signature, event = 'issue_comment' } = {}) {
  const payload = signed(body);
  return fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': signature || payload.signature,
    },
    body: payload.raw,
  });
}

const payload = (userId, org, installationId = 555) => ({
  action: 'created',
  sender: { login: 'alice', id: userId },
  organization: { login: org },
  installation: { id: installationId },
});

test.before(async () => {
  await prisma.account.upsert({
    where: { type_id: { type: 'github', id: USER_ID } },
    update: {},
    create: { type: 'github', id: USER_ID },
  });
  await prisma.appInstallation.upsert({
    where: { platform_orgName: { platform: 'github', orgName: ORG } },
    update: {},
    create: { platform: 'github', orgName: ORG, installationId: '555', accountType: 'github', accountId: USER_ID },
  });
  server = createApp().listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await prisma.agentTask.deleteMany({ where: { payload: { contains: ORG } } });
  await prisma.account.delete({ where: { type_id: { type: 'github', id: USER_ID } } });
  await prisma.$disconnect();
});

const triggerComment = (userId, org, installationId = 555, body = '@openrouter/free\nhi') => ({
  ...payload(userId, org, installationId),
  repository: { full_name: `${org}/web`, owner: { login: org } },
  issue: { number: 1, title: 'Bug' },
  comment: { id: 5, body, user: { login: 'alice', type: 'User' } },
});

test('queues a signed trigger comment in an imported org', async () => {
  const res = await postGithub(triggerComment(USER_ID, ORG));
  assert.equal(res.status, 200);
  const { taskId } = await res.json();
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  assert.equal(task.status, 'pending');
  assert.equal(task.event, 'issue_comment');
  assert.equal(JSON.parse(task.payload).organization.login, ORG);
});

test('rejects a bad signature with 401 and says which setting to fix', async () => {
  const res = await postGithub(triggerComment(USER_ID, ORG), { signature: 'sha256=00' });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /X-Hub-Signature-256 does not match GITHUB_WEBHOOK_SECRET/);
});

test('anyone may trigger in an imported org: no account is needed to be queued', async () => {
  const before = await prisma.agentTask.count();
  const res = await postGithub(triggerComment('stranger', ORG));
  assert.equal(res.status, 200);
  assert.equal(await prisma.agentTask.count(), before + 1);
});

test('rejects a trigger in an org nobody imported, or from another installation, with 403', async () => {
  const before = await prisma.agentTask.count();
  for (const body of [triggerComment(USER_ID, 'other-org'), triggerComment(USER_ID, ORG, 999)]) {
    const res = await postGithub(body);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Unauthorized' });
  }
  assert.equal(await prisma.agentTask.count(), before);
});

test('ignores events that are not trigger comments, without queueing', async () => {
  const before = await prisma.agentTask.count();
  for (const body of [payload(USER_ID, ORG), triggerComment(USER_ID, ORG, 555, 'just a comment')]) {
    const res = await postGithub(body);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ignored' });
  }
  assert.equal(await prisma.agentTask.count(), before);
});

test('answers a ping without queueing', async () => {
  const res = await postGithub({ zen: 'hi' }, { event: 'ping' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'pong' });
});

test('rejects a GitLab hook with the wrong token', async () => {
  const res = await fetch(`${baseUrl}/api/webhooks/gitlab`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gitlab-token': 'wrong' },
    body: JSON.stringify({ object_kind: 'note' }),
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /X-Gitlab-Token does not match GITLAB_WEBHOOK_SECRET/);
});

test('rejects a GitLab hook with no token, saying none was sent', async () => {
  const res = await fetch(`${baseUrl}/api/webhooks/gitlab`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ object_kind: 'note' }),
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /no X-Gitlab-Token header/);
});

test('under PROD=prod with no secret set, refuses with 401 and names the missing setting', async () => {
  const config = require('../src/config');
  const saved = [config.isProd, config.github.webhookSecret];
  config.isProd = true;
  config.github.webhookSecret = '';
  try {
    const res = await postGithub(triggerComment(USER_ID, ORG));
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /GITHUB_WEBHOOK_SECRET is not set on the server/);
  } finally {
    [config.isProd, config.github.webhookSecret] = saved;
  }
});
