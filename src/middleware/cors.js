const config = require('../config');

// Lets the git-client-agents dashboard call the API from another origin. Auth is a header
// token, never a cookie, so allowing an origin grants nothing by itself.
function cors(req, res, next) {
  const origin = req.get('origin');
  const allowed = config.corsOrigins;
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    res.set('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Platform');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
}

module.exports = { cors };
