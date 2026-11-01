// The workspace tools: the agent opens a GitHub Codespace for this repository, runs commands in
// it, commits and pushes a branch, and deletes it. Offered only on GitHub, only to commenters
// with write access, and only when a workspace key they may use exists (see agent/index.js).
//
// Zero trust: keys arrive as handles (workspaceKeyService); each call decrypts the key right
// before it is used. The tools only touch codespaces they created in this answer, never another
// codespace the key's owner has, and cleanup() deletes whatever is left when the answer ends.
const codespaces = require('../platforms/githubCodespacesService');
const { ToolInputError } = require('./threadActions');
const { logSafe } = require('../../utils/strings');
const log = require('../logService');

// The most output one exec_command returns to the model.
const MAX_OUTPUT_CHARS = 10_000;
// Codespaces one answer may open; each one bills the key's owner.
const MAX_WORKSPACES = 2;
// GitHub answers these when a key is not allowed to open a codespace here; the next key may be.
const KEY_REFUSALS = new Set([401, 403, 404, 422]);

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, ...(required.length ? { required } : {}) } },
});
const WORKSPACE_ID = { type: 'string', description: 'The workspaceId create_workspace returned.' };

const WORKSPACE_TOOLS = [
  fn(
    'create_workspace',
    'Start a cloud development environment (a GitHub Codespace) for this repository, checked out at a branch. It takes one to three minutes. Use it only when the work needs running commands or changing code.',
    { branch: { type: 'string', description: 'The branch to check out. Omit it for the branch being discussed, or the default branch.' } }
  ),
  fn(
    'exec_command',
    'Run a shell command in a workspace, in the repository folder, and get stdout, stderr and exitCode. Output is cut to 10,000 characters.',
    { workspaceId: WORKSPACE_ID, command: { type: 'string', description: 'A bash command, e.g. "npm ci && npm test".' } },
    ['workspaceId', 'command']
  ),
  fn(
    'commit_workspace',
    'Commit every change in the workspace and push it to a branch (created if it does not exist). It never pushes to the default branch: open a pull request from the branch instead.',
    {
      workspaceId: WORKSPACE_ID,
      commitMessage: { type: 'string', description: 'The commit message.' },
      branchName: { type: 'string', description: 'The branch to push, e.g. "fix/login-redirect".' },
    },
    ['workspaceId', 'commitMessage', 'branchName']
  ),
  fn('delete_workspace', 'Delete a workspace when the work is done. Workspaces left open are deleted when this answer ends.', { workspaceId: WORKSPACE_ID }, ['workspaceId']),
];

// Keeps the end of long output (where errors usually are) and says how much was cut. The
// result, note included, is never longer than `max`.
function clip(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  if (max <= 0) return '';
  const note = `[${value.length} characters, only the last ones shown]\n`;
  return note.length >= max ? value.slice(-max) : `${note}${value.slice(-(max - note.length))}`;
}

// stdout and stderr together stay within `max`: stderr may take up to 30%, and stdout whatever
// stderr does not need.
function clipOutput({ stdout, stderr }, max = MAX_OUTPUT_CHARS) {
  const out = String(stdout || '');
  const err = String(stderr || '');
  const errShare = Math.min(err.length, Math.floor(max * 0.3));
  const outShare = Math.min(out.length, max - errShare);
  return { stdout: clip(out, outShare), stderr: clip(err, max - outShare) };
}

// A single-quoted shell word: safe for any text, quotes included.
function shellQuote(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`;
}

function failure(name, err) {
  if (err instanceof ToolInputError || err.code === 'BAD_INPUT') return `Error: ${name}: ${err.message}.`;
  const status = err.response && err.response.status;
  const hint = status === 401 || status === 403 ? ' The workspace key may lack the codespace scope, or Codespaces may be off for this repository.' : '';
  return `Error: ${name} failed: ${err.message}.${hint}`;
}

// `repo` is "owner/name", `defaultBranch` the repository's, `branch` the one being discussed (the
// PR head) or null. `keys` are workspace key handles in fallback order. `onProgress({ status,
// tool })` hears each step, for the chat. Returns { handlers, cleanup, openWorkspaces }: the handlers are named like the tools.
function createWorkspaceTools({ repo, defaultBranch = null, branch = null, keys, onProgress = () => {}, logMeta } = {}) {
  if (!keys || keys.length === 0) throw new Error('workspace tools need at least one workspace key');
  // workspaceId -> the handle of the key that created it. A handle holds no token: reveal()
  // reads and decrypts the row again for every call.
  const owned = new Map();

  const progress = (tool, status) => {
    try {
      onProgress({ tool, status });
    } catch {
      // Progress is best effort.
    }
  };
  const ownedKey = (workspaceId) => {
    const key = owned.get(String(workspaceId || ''));
    if (!key) throw new ToolInputError(`${workspaceId || 'no workspaceId'} is not a workspace this answer created`);
    return key;
  };

  async function createWithFallback(ref) {
    let lastError;
    for (const key of keys) {
      try {
        const created = await codespaces.createCodespace(repo, ref, await key.reveal());
        return { created, key };
      } catch (err) {
        lastError = err;
        const status = err.response && err.response.status;
        if (!(KEY_REFUSALS.has(status) || err.code === 'NO_WORKSPACE_KEY')) throw err;
        log.warn('agent', `${key.owner} workspace key ${key.id} refused (${status || err.code}), trying the next`, logMeta);
      }
    }
    throw lastError;
  }

  async function createWorkspace(args) {
    if (owned.size >= MAX_WORKSPACES) throw new ToolInputError(`this answer already has ${owned.size} workspaces; reuse or delete one`);
    const ref = args.branch ? String(args.branch).trim() : branch || defaultBranch || null;
    progress('create_workspace', 'Creating GitHub Codespace...');
    const { created, key } = await createWithFallback(ref);
    owned.set(created.name, key);
    log.info('agent', `created codespace ${logSafe(created.name)} for ${logSafe(repo)} with the ${key.owner} workspace key`, logMeta);
    const ready = await codespaces.waitUntilAvailable(created.name, () => key.reveal(), {
      onState: (state) => progress('create_workspace', `Codespace ${created.name} is ${state}`),
    });
    progress('create_workspace', `Codespace ${created.name} is ready`);
    return JSON.stringify({ workspaceId: created.name, state: ready.state, repository: repo, branch: created.branch || ref });
  }

  async function run(workspaceId, command) {
    const key = ownedKey(workspaceId);
    return codespaces.executeCommand(String(workspaceId), command, await key.reveal());
  }

  async function execCommand(args) {
    if (typeof args.command !== 'string' || !args.command.trim()) throw new ToolInputError('command is required');
    progress('exec_command', `Running: ${args.command.slice(0, 120)}`);
    const result = await run(args.workspaceId, args.command);
    return JSON.stringify({ ...clipOutput(result), exitCode: result.exitCode, ...(result.timedOut ? { timedOut: true } : {}) });
  }

  async function commitWorkspace(args) {
    const target = String(args.branchName || '').trim();
    const message = String(args.commitMessage || '').trim();
    if (!message) throw new ToolInputError('commitMessage is required');
    if (!codespaces.isValidBranch(target)) throw new ToolInputError(`"${target}" is not a valid branch name`);
    if (defaultBranch && target === defaultBranch) throw new ToolInputError(`refusing to push to the default branch ${defaultBranch}; push a new branch and open a pull request`);
    progress('commit_workspace', `Committing and pushing to ${target}...`);
    const b = shellQuote(target);
    const script = [
      'set -e',
      `git checkout -B ${b}`,
      'git add -A',
      `if git diff --cached --quiet; then echo "nothing to commit"; else git commit -m ${shellQuote(message)}; fi`,
      `git push -u origin ${b}`,
      'git rev-parse HEAD',
    ].join('\n');
    const result = await run(args.workspaceId, script);
    return JSON.stringify({ ...clipOutput(result), exitCode: result.exitCode, branch: target, pushed: result.exitCode === 0 });
  }

  async function deleteWorkspace(args) {
    const key = ownedKey(args.workspaceId);
    progress('delete_workspace', `Deleting codespace ${args.workspaceId}...`);
    await codespaces.deleteCodespace(String(args.workspaceId), await key.reveal());
    owned.delete(String(args.workspaceId));
    return JSON.stringify({ workspaceId: args.workspaceId, deleted: true });
  }

  // Each handler returns text for the model; failures become "Error: ..." so it can react.
  const wrap = (name, handler) => async (args) => {
    try {
      return await handler(args || {});
    } catch (err) {
      return failure(name, err);
    }
  };

  // Deletes every codespace still open. Never throws: the answer is already decided.
  async function cleanup() {
    for (const [name, key] of [...owned]) {
      try {
        await codespaces.deleteCodespace(name, await key.reveal());
        owned.delete(name);
        log.info('agent', `deleted codespace ${logSafe(name)} at the end of the answer`, logMeta);
      } catch (err) {
        log.warn('agent', `could not delete codespace ${logSafe(name)}: ${logSafe(err.message)}`, logMeta);
      }
    }
  }

  const handlers = {
    create_workspace: wrap('create_workspace', createWorkspace),
    exec_command: wrap('exec_command', execCommand),
    commit_workspace: wrap('commit_workspace', commitWorkspace),
    delete_workspace: wrap('delete_workspace', deleteWorkspace),
  };
  // cleanup sits beside the handlers, never among them, so the model cannot call it as a tool.
  return { handlers, cleanup, openWorkspaces: () => [...owned.keys()] };
}

module.exports = { WORKSPACE_TOOLS, createWorkspaceTools, clipOutput, shellQuote, MAX_OUTPUT_CHARS, MAX_WORKSPACES };
