// Browser redirects for "Continue with GitHub / GitLab". The token comes back to the dashboard
// in the URL fragment, which browsers never send to a server.
const crypto = require('crypto');
const config = require('../config');
const oauth = require('../services/oauthService');
const { HttpError } = require('../errors');

const NONCE_COOKIE = 'gsa_oauth_nonce';

function callbackUrl(req, platform) {
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/${platform}/callback`;
}

function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function nonceCookie(req, value, maxAge) {
  const secure = (config.publicUrl || `${req.protocol}:`).startsWith('https:') ? '; Secure' : '';
  return `${NONCE_COOKIE}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function backToDashboard(res, redirect, fields) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(302, `${redirect}#${new URLSearchParams(fields)}`);
}

function providers(_req, res) {
  res.json(oauth.providers());
}

function start(req, res) {
  const { platform } = req.params;
  oauth.requireEnabled(platform);
  const redirect = oauth.checkRedirect(req.query.redirect);
  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = oauth.signState({ platform, redirect, nonce });
  res.set('Set-Cookie', nonceCookie(req, nonce, 600));
  res.set('Cache-Control', 'no-store');
  res.redirect(302, oauth.authorizeUrl(platform, { redirectUri: callbackUrl(req, platform), state }));
}

async function callback(req, res) {
  const { platform } = req.params;
  oauth.requireEnabled(platform);
  const state = oauth.verifyState(req.query.state);
  if (state.platform !== platform) throw new HttpError(400, 'invalid sign-in state');
  // Re-check, in case CORS_ORIGINS changed while the user was away.
  const redirect = oauth.checkRedirect(state.redirect);
  res.set('Set-Cookie', nonceCookie(req, '', 0));

  const nonce = readCookie(req, NONCE_COOKIE);
  const sameBrowser =
    nonce.length === state.nonce.length && crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(state.nonce));
  if (!sameBrowser) return backToDashboard(res, redirect, { error: 'Sign-in was started in another browser. Try again.' });
  if (req.query.error) {
    return backToDashboard(res, redirect, { error: String(req.query.error_description || req.query.error) });
  }
  if (!req.query.code) return backToDashboard(res, redirect, { error: 'The platform returned no code.' });

  try {
    const token = await oauth.exchangeCode(platform, { code: String(req.query.code), redirectUri: callbackUrl(req, platform) });
    return backToDashboard(res, redirect, { platform, token });
  } catch (err) {
    return backToDashboard(res, redirect, { error: err.expose ? err.message : 'Sign-in failed.' });
  }
}

module.exports = { providers, start, callback };
