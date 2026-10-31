const express = require('express');
const webhooks = require('./routes/webhooks');

function createApp() {
  const app = express();

  // Keep the raw bytes: GitHub signs the exact body it sent, not our re-serialisation.
  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/webhooks', webhooks);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[app]', err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
