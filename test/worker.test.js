// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` first.
const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/db');
const { requeueStale, runOnce } = require('../src/worker');
const agent = require('../src/services/agentService');

const MARK = 'worker-test-stale';

test.after(async () => {
  await prisma.agentTask.deleteMany({ where: { payload: { contains: MARK } } });
  await prisma.$disconnect();
});

test('tasks stuck in processing for over 30 minutes go back to pending; recent ones stay', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const create = (updatedAt) =>
    prisma.agentTask.create({ data: { platform: 'github', event: 'issue_comment', status: 'processing', payload: MARK, updatedAt } });
  const stale = await create(new Date(Date.now() - 31 * 60_000));
  const fresh = await create(new Date(Date.now() - 5 * 60_000));
  assert.ok((await requeueStale()) >= 1);
  const [a, b] = await Promise.all([stale.id, fresh.id].map((id) => prisma.agentTask.findUnique({ where: { id } })));
  assert.equal(a.status, 'pending');
  assert.equal(b.status, 'processing');
});

test('a batch runs its tasks at the same time, not one after another', async (t) => {
  t.mock.method(console, 'log', () => {});
  await prisma.agentTask.updateMany({ where: { status: 'pending' }, data: { status: 'skipped' } });
  for (let i = 0; i < 3; i += 1) {
    await prisma.agentTask.create({ data: { platform: 'github', event: 'issue_comment', payload: `${MARK}-batch-${i}` } });
  }
  let running = 0;
  let peak = 0;
  t.mock.method(agent, 'processTask', async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 50));
    running -= 1;
    return 'success';
  });
  assert.equal(await runOnce(3), 3);
  assert.equal(peak, 3);
});
