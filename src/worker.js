const config = require('./config');
const prisma = require('./db');
const { processTask } = require('./services/agentService');

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
      console.log(`[worker] ${task.id} ${task.platform}/${task.event} -> ${status}`);
    } catch (err) {
      await prisma.agentTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorLog: describe(err).slice(0, 10000) },
      });
      console.error(`[worker] ${task.id} ${task.platform}/${task.event} -> failed: ${err.message}`);
    }
  }
  return pending.length;
}

function start({ pollMs = config.worker.pollMs } = {}) {
  let timer = null;
  let stopped = false;

  const tick = async () => {
    try {
      // Drain the queue before going back to sleep.
      while (!stopped && (await runOnce()) > 0);
    } catch (err) {
      console.error('[worker] poll failed:', err.message);
    }
    if (!stopped) timer = setTimeout(tick, pollMs);
  };

  console.log(`[worker] polling every ${pollMs}ms`);
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = { start, runOnce };

if (require.main === module) {
  const stop = start();
  process.on('SIGINT', () => {
    stop();
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
