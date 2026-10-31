// Runs against the database selected by scripts/setup-db.js; run `npm run db:push` first.
const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/db');
const { requeueStale } = require('../src/worker');

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
