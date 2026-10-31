const express = require('express');
const webhooks = require('./routes/webhooks');
const admin = require('./routes/admin');
const user = require('./routes/user');
const auth = require('./routes/auth');
const { cors } = require('./middleware/cors');
const { HttpError } = require('./errors');
const log = require('./services/logService');

// Known Prisma request errors become client errors instead of 500s.
function prismaError(err) {
  const map = { P2025: [404, 'not found'], P2002: [409, 'already exists'], P2003: [400, 'referenced row does not exist'] };
  const hit = err && map[err.code];
  return hit ? new HttpError(...hit) : null;
}

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
  app.use('/api/auth', cors, auth);
  app.use('/api/admin', cors, admin);
  app.use('/api/user', cors, user);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const mapped = prismaError(err) || err;
    if (!mapped.status || mapped.status >= 500) log.error('app', (err && err.stack) || String(err));
    res.status(mapped.status || 500).json({ error: mapped.expose ? mapped.message : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
