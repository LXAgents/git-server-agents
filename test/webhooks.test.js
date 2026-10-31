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
    create: { type: 'github', id: USER_ID, username: 'alice' },
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

test('queues a signed event from a whitelisted user and org', async () => {
  const res = await postGithub(payload(USER_ID, ORG));
  assert.equal(res.status, 200);
  const { taskId } = await res.json();
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  assert.equal(task.status, 'pending');
  assert.equal(task.event, 'issue_comment');
  assert.equal(JSON.parse(task.payload).organization.login, ORG);
});

test('rejects a bad signature with 401', async () => {
  const res = await postGithub(payload(USER_ID, ORG), { signature: 'sha256=00' });
  assert.equal(res.status, 401);
});

test('rejects an unknown user, org or installation with 403 and queues nothing', async () => {
  const before = await prisma.agentTask.count();
  for (const body of [payload('stranger', ORG), payload(USER_ID, 'other-org'), payload(USER_ID, ORG, 999)]) {
    const res = await postGithub(body);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Unauthorized' });
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
});
