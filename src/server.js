const config = require('./config');
const { createApp } = require('./app');
const worker = require('./worker');
const setupCheck = require('./setupCheck');
const log = require('./services/logService');

const app = createApp();

app.listen(config.port, () => {
  log.info('server', `listening on :${config.port} (${config.isProd ? 'PostgreSQL' : 'SQLite'})`);
  void setupCheck.run();
});

// Stored log lines older than LOG_RETENTION_DAYS go at start and then every six hours.
const pruneLogs = () =>
  log.prune().catch((err) => console.error(`[log] could not delete old log lines: ${err.message}`));
void pruneLogs();
setInterval(() => void pruneLogs(), 6 * 3_600_000).unref();

// One process by default; set WORKER_INLINE=false and run `npm run worker` to split them.
if (config.worker.inline) worker.start();
