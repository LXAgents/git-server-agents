const config = require('./config');
const prisma = require('./db');
const { processTask } = require('./services/agentService');
const { logSafe } = require('./utils/strings');

function describe(err) {
  const response = err.response;
  if (!response) return err.stack || String(err);
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  return `${err.message} (${response.config && response.config.url}): ${body}`;
}

// Moves a pending task to "processing" only if nobody else has, so several workers can
// poll the same table without answering a comment twice.
async function claim(task) {
  const { count } = await prisma.agentTask.updateMany({
    where: { id: task.id, status: 'pending' },
    data: { status: 'processing' },
  });
  return count === 1;
}

async function runOnce(limit = 10) {
  const pending = await prisma.agentTask.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  for (const task of pending) {
    if (!(await claim(task))) continue;
    try {
      const status = await processTask(task);
      await prisma.agentTask.update({ where: { id: task.id }, data: { status } });
      console.log(`[worker] ${task.id} ${task.platform}/${logSafe(task.event)} -> ${status}`);
    } catch (err) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorLog: describe(err).slice(0, 10000) },
      });
      console.error(`[worker] ${task.id} ${task.platform}/${logSafe(task.event)} -> failed: ${logSafe(err.message)}`);
    }
  }
  return pending.length;
}

// A task left in "processing" by a restart or redeploy would never finish. One that has been
// there longer than any answer can take (6 model calls of 120 s per key) goes back to pending.
const STALE_MS = 30 * 60_000;
async function requeueStale(now = Date.now()) {
  const { count } = await prisma.agentTask.updateMany({
    where: { status: 'processing', updatedAt: { lt: new Date(now - STALE_MS) } },
    data: { status: 'pending' },
  });
  if (count) console.warn(`[worker] re-queued ${count} task(s) stuck in processing`);
  return count;
}

function start({ pollMs = config.worker.pollMs } = {}) {
  let timer = null;
  let stopped = false;

  // Drains the queue before going back to sleep. `stopped` is set by the returned stop()
  // while a batch is running.
  const tick = async () => {
    try {
      for (;;) {
        const processed = await runOnce();
        if (processed === 0 || stopped) break;
      }
    } catch (err) {
      console.error('[worker] poll failed:', err.message);
    }
    if (!stopped) timer = setTimeout(() => void tick(), pollMs);
  };

  console.log(`[worker] polling every ${pollMs}ms`);
  requeueStale()
    .catch((err) => console.error('[worker] could not re-queue stale tasks:', err.message))
    .finally(() => {
      if (!stopped) void tick();
    });
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = { start, runOnce, requeueStale };

if (require.main === module) {
  const stop = start();
  process.on('SIGINT', () => {
    stop();
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
