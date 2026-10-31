const config = require('./config');
const prisma = require('./db');
const agent = require('./services/agentService');
const { logSafe } = require('./utils/strings');
const log = require('./services/logService');

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

// Runs one claimed task to its end state and logs the outcome with how long it took.
async function handle(task) {
  const started = Date.now();
  const label = `${task.id} ${task.platform}/${logSafe(task.event)}`;
  const meta = { platform: task.platform, taskId: task.id };
  log.info('worker', `${label} claimed`, meta);
  try {
    const status = await agent.processTask(task);
    await prisma.agentTask.update({ where: { id: task.id }, data: { status } });
    log.info('worker', `${label} -> ${status} in ${Date.now() - started}ms`, meta);
  } catch (err) {
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: 'failed', errorLog: describe(err).slice(0, 10000) },
    });
    log.error('worker', `${label} -> failed in ${Date.now() - started}ms: ${logSafe(err.message)}`, meta);
  }
}

// Claims up to `limit` pending tasks, oldest first, and starts each one. Returns the promises.
async function claimBatch(limit) {
  if (limit <= 0) return [];
  const pending = await prisma.agentTask.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  const started = [];
  for (const task of pending) {
    if (await claim(task)) started.push(handle(task));
  }
  return started;
}

// One batch of up to `limit` tasks, run in parallel. Resolves once they are all done.
async function runOnce(limit = config.worker.concurrency) {
  const started = await claimBatch(limit);
  await Promise.all(started);
  return started.length;
}

// A task left in "processing" by a restart or redeploy would never finish. One that has been
// there far longer than an answer may take (TASK_TIMEOUT_MS) goes back to pending.
const STALE_MS = 30 * 60_000;
async function requeueStale(now = Date.now()) {
  const { count } = await prisma.agentTask.updateMany({
    where: { status: 'processing', updatedAt: { lt: new Date(now - STALE_MS) } },
    data: { status: 'pending' },
  });
  if (count) log.warn('worker', `re-queued ${count} task(s) stuck in processing`);
  return count;
}

// Keeps up to `concurrency` tasks running. A slow answer holds one slot, not the whole queue:
// the next comment starts as soon as any slot is free.
function start({ pollMs = config.worker.pollMs, concurrency = config.worker.concurrency } = {}) {
  let timer = null;
  let stopped = false;
  let filling = false;
  const running = new Set();

  const fill = async () => {
    if (stopped || filling) return;
    filling = true;
    try {
      for (const promise of await claimBatch(concurrency - running.size)) {
        running.add(promise);
        void promise.finally(() => {
          running.delete(promise);
          void fill();
        });
      }
    } catch (err) {
      log.error('worker', `poll failed: ${err.message}`);
    } finally {
      filling = false;
    }
  };

  const tick = async () => {
    await fill();
    if (!stopped) timer = setTimeout(() => void tick(), pollMs);
  };

  log.info('worker', `polling every ${pollMs}ms, up to ${concurrency} tasks at once`);
  requeueStale()
    .catch((err) => log.error('worker', `could not re-queue stale tasks: ${err.message}`))
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
