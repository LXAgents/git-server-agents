const config = require('./config');
const { createApp } = require('./app');
const worker = require('./worker');
const setupCheck = require('./setupCheck');

const app = createApp();

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (${config.isProd ? 'PostgreSQL' : 'SQLite'})`);
  void setupCheck.run();
});

// One process by default; set WORKER_INLINE=false and run `npm run worker` to split them.
if (config.worker.inline) worker.start();
