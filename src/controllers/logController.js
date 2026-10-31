// The owner's Logs page. Lines tagged with a platform are shown only to that platform's owner;
// lines about the server itself (no platform) are shown to both.
const prisma = require('../db');
const { LEVELS } = require('../services/logService');
const { HttpError } = require('../errors');

const MAX_LIMIT = 200;

// "warn" lists warnings and errors, "error" errors only, and "info" (the default) everything.
function levelsFrom(value) {
  if (value === undefined || value === '') return LEVELS;
  const index = LEVELS.indexOf(String(value).toLowerCase());
  if (index === -1) throw new HttpError(400, `level must be one of ${LEVELS.join(', ')}`);
  return LEVELS.slice(index);
}

function limitFrom(value) {
  const n = Number(value);
  if (value === undefined || value === '') return 100;
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'limit must be a positive whole number');
  return Math.min(n, MAX_LIMIT);
}

function logView(row) {
  return {
    id: row.id,
    level: row.level,
    source: row.source,
    message: row.message,
    platform: row.platform,
    taskId: row.taskId,
    createdAt: row.createdAt,
  };
}

// Newest first. Pass the last line's id as `before` for the next page.
async function listLogs(req, res) {
  const { level, source, before, limit } = req.query;
  const take = limitFrom(limit);
  const where = {
    level: { in: levelsFrom(level) },
    OR: [{ platform: req.admin.platform }, { platform: null }],
  };
  if (source) where.source = String(source);
  const rows = await prisma.log.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(before ? { cursor: { id: String(before) }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  res.json({ logs: page.map(logView), next: rows.length > take ? page.at(-1).id : null });
}

module.exports = { listLogs };
