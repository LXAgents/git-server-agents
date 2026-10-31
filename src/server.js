const config = require('./config');
const { createApp } = require('./app');

const app = createApp();

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (${config.isProd ? 'PostgreSQL' : 'SQLite'})`);
});
