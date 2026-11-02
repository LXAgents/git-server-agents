// Keeps the codespace an answer used, so the next message in the same conversation (a chat
// session, or an issue or pull request thread) can use it instead of waiting minutes for a new
// one. Kept for config.workspace.keepMinutes after the answer, then deleted.
//
// Memory only: after a restart the server forgets them, and GitHub deletes them by itself
// (retention_period_minutes is set when they are created). An entry holds the key handle, never
// a token: reveal() reads and decrypts the key again when the codespace is deleted.
const codespaces = require('../platforms/githubCodespacesService');
const config = require('../../config');
const { logSafe } = require('../../utils/strings');
const log = require('../logService');

const SWEEP_MS = 60_000;
// scope -> { name, repo, branch, key, expiresAt }
const kept = new Map();
let timer = null;

async function remove(name, key, why) {
  try {
    await codespaces.deleteCodespace(name, await key.reveal());
    log.info('agent', `deleted codespace ${logSafe(name)} ${why}`);
  } catch (err) {
    log.warn('agent', `could not delete codespace ${logSafe(name)}: ${logSafe(err.message)}`);
  }
}

// Deletes the codespaces whose keep window has passed. Never throws.
async function sweep(now = Date.now()) {
  const due = [...kept].filter(([, entry]) => entry.expiresAt <= now);
  for (const [scope, entry] of due) {
    kept.delete(scope);
    await remove(entry.name, entry.key, 'after its keep window');
  }
  if (kept.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function startSweeping() {
  if (timer) return;
  timer = setInterval(() => void sweep(), SWEEP_MS);
  // The timer alone never keeps the process (or a test run) alive.
  if (timer.unref) timer.unref();
}

// Keeps `entry` ({ name, repo, branch, key }) for `scope`. A codespace already kept for the scope
// is deleted first, so a scope holds at most one. Resolves to whether it was kept (false when
// keeping is off or there is no scope; the caller then deletes it).
async function keep(scope, entry, { minutes = config.workspace.keepMinutes } = {}) {
  if (!scope || !(minutes > 0)) return false;
  const old = kept.get(scope);
  if (old && old.name !== entry.name) await remove(old.name, old.key, 'replaced by a newer one');
  kept.set(scope, { ...entry, expiresAt: Date.now() + minutes * 60_000 });
  startSweeping();
  return true;
}

// Hands the codespace kept for `scope` to an answer, and forgets it here (the answer keeps it
// again when it ends). Only for the same repository, and only when the answer may use the key
// that created it (`keyIds` are the asker's usable workspace keys): otherwise it stays kept.
function take(scope, { repo, keyIds = [] } = {}) {
  const entry = scope ? kept.get(scope) : null;
  if (!entry || entry.repo !== repo || !keyIds.includes(entry.key.id)) return null;
  kept.delete(scope);
  return entry;
}

// For tests and shutdown: forget everything and stop the timer (codespaces are left to GitHub's
// retention period).
function reset() {
  kept.clear();
  if (timer) clearInterval(timer);
  timer = null;
}

const size = () => kept.size;

module.exports = { keep, take, sweep, reset, size };
