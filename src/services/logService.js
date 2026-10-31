const config = require('../config');

// One place for server log lines: each goes to the console as before and, unless LOG_STORE=false,
// into the Log table for the owner's Logs page. Storing is best effort: a failed write is
// printed and never breaks the request or task that logged.
const LEVELS = ['info', 'warn', 'error'];
const CONSOLE = { info: 'log', warn: 'warn', error: 'error' };
const MAX_MESSAGE = 2000;

// The test runner sets NODE_TEST_CONTEXT in every test process. Tests that check storing turn it
// on with setStore, so other tests don't leave writes running after they disconnect.
let store = config.logs.store && !process.env.NODE_TEST_CONTEXT;
const pending = new Set();

function setStore(value) {
  store = Boolean(value);
}

function write(level, source, message, { platform = null, taskId = null } = {}) {
  const text = String(message);
  console[CONSOLE[level]](`[${source}] ${text}`);
  if (!store) return;
  // Required here, so a module that only logs doesn't open the database by loading this one.
  const prisma = require('../db');
  const job = prisma.log
    .create({ data: { level, source, message: text.slice(0, MAX_MESSAGE), platform, taskId } })
    .catch((err) => console.error(`[log] could not store a log line: ${err.message}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

const info = (source, message, meta) => write('info', source, message, meta);
const warn = (source, message, meta) => write('warn', source, message, meta);
const error = (source, message, meta) => write('error', source, message, meta);

// Resolves once every stored line so far is written.
async function flush() {
  await Promise.all([...pending]);
}

// Deletes lines older than LOG_RETENTION_DAYS. Returns how many went.
async function prune(now = Date.now(), days = config.logs.retentionDays) {
  const prisma = require('../db');
  const { count } = await prisma.log.deleteMany({ where: { createdAt: { lt: new Date(now - days * 86_400_000) } } });
  return count;
}

module.exports = { LEVELS, info, warn, error, flush, prune, setStore };
