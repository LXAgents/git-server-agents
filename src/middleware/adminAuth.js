const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../errors');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

// The operator's static token. Accepts "Bearer <token>" or the bare token. With no
// ADMIN_TOKEN configured the admin API is closed rather than open.
function adminAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const supplied = header.replace(/^Bearer\s+/i, '');
  const expected = config.adminToken;
  if (!expected || !supplied || !crypto.timingSafeEqual(digest(supplied), digest(expected))) {
    return next(new HttpError(401, 'Unauthorized'));
  }
  return next();
}

module.exports = { adminAuth };
