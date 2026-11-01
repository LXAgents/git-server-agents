// GitHub Codespaces for the agent's workspace tools. The token is a workspace key (a personal
// access token with the codespace scope), passed in by the caller right after it was decrypted
// and never kept here. REST calls go to GITHUB_API_URL; commands run through the gh CLI, because
// the REST API cannot run a command inside a codespace.
const childProcess = require('child_process');
const axios = require('axios');
require('../../http');
const config = require('../../config');

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CODESPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// Git refuses these in branch names; refusing them here keeps odd input out of the API path.
const BAD_BRANCH = /(^[-/.])|\.\.|[\s~^:?*[\\]|@\{|\/$|\.lock$|\.$/;

// A Codespaces failure: `source` lets agentErrors tell it from the AI provider and the platform.
// `code` is WORKSPACE_ERROR (GitHub refused or failed) or WORKSPACE_UNAVAILABLE (gh missing,
// codespace never became available).
class CodespacesError extends Error {
  constructor(message, { code = 'WORKSPACE_ERROR', response, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.source = 'codespaces';
    this.code = code;
    if (response) this.response = response;
  }
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

// GitHub's own message, without the token (axios errors carry the request config).
function wrap(err, action) {
  if (err instanceof CodespacesError) return err;
  const res = err.response;
  const detail = res && res.data && (res.data.message || (typeof res.data === 'string' ? res.data : ''));
  const status = res ? ` (HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''})` : ` (${err.code || err.message})`;
  return new CodespacesError(`GitHub could not ${action}${status}`, {
    response: res ? { status: res.status, data: res.data, headers: res.headers } : undefined,
  });
}

function requireName(name) {
  if (typeof name !== 'string' || !CODESPACE_NAME.test(name)) throw new CodespacesError('a valid codespace name is required', { code: 'BAD_INPUT' });
  return name;
}

function view(data) {
  return {
    name: data.name,
    state: data.state,
    repository: data.repository && data.repository.full_name,
    branch: data.git_status && data.git_status.ref,
    webUrl: data.web_url,
    machine: data.machine && data.machine.name,
  };
}

// POST /repos/{owner}/{repo}/codespaces. `branch` may be left out for the default branch.
async function createCodespace(repoFullName, branch, token, { idleTimeoutMinutes = config.workspace.idleTimeoutMinutes } = {}) {
  if (typeof repoFullName !== 'string' || !REPO_NAME.test(repoFullName)) throw new CodespacesError('repository must be "owner/name"', { code: 'BAD_INPUT' });
  if (branch !== undefined && branch !== null && (typeof branch !== 'string' || !branch || BAD_BRANCH.test(branch))) {
    throw new CodespacesError(`"${branch}" is not a valid branch name`, { code: 'BAD_INPUT' });
  }
  const [owner, repo] = repoFullName.split('/');
  const body = { idle_timeout_minutes: idleTimeoutMinutes };
  if (branch) body.ref = branch;
  try {
    const { data } = await axios.post(`${config.github.apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/codespaces`, body, { headers: headers(token) });
    return view(data);
  } catch (err) {
    throw wrap(err, `create a codespace for ${repoFullName}`);
  }
}

// GET /user/codespaces/{codespace_name}.
async function getCodespaceStatus(codespaceName, token) {
  const name = requireName(codespaceName);
  try {
    const { data } = await axios.get(`${config.github.apiUrl}/user/codespaces/${encodeURIComponent(name)}`, { headers: headers(token) });
    return view(data);
  } catch (err) {
    throw wrap(err, `read codespace ${name}`);
  }
}

// DELETE /user/codespaces/{codespace_name}. A codespace that is already gone counts as deleted.
async function deleteCodespace(codespaceName, token) {
  const name = requireName(codespaceName);
  try {
    await axios.delete(`${config.github.apiUrl}/user/codespaces/${encodeURIComponent(name)}`, { headers: headers(token) });
    return { name, deleted: true };
  } catch (err) {
    if (err.response && err.response.status === 404) return { name, deleted: true, alreadyGone: true };
    throw wrap(err, `delete codespace ${name}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FAILED_STATES = new Set(['Failed', 'Deleted', 'Unavailable']);

// Polls the status until the codespace is Available, a failed state, or `timeoutMs` passes.
// `getToken` is called for every poll, so the token is decrypted at each use.
async function waitUntilAvailable(codespaceName, getToken, { timeoutMs = config.workspace.bootTimeoutMs, pollMs = 5000, onState } = {}) {
  const until = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    const status = await getCodespaceStatus(codespaceName, await getToken());
    if (onState && status.state !== last) onState(status.state);
    last = status.state;
    if (status.state === 'Available') return status;
    if (FAILED_STATES.has(status.state)) throw new CodespacesError(`codespace ${codespaceName} is ${status.state}`, { code: 'WORKSPACE_UNAVAILABLE' });
    if (Date.now() + pollMs > until) {
      throw new CodespacesError(`codespace ${codespaceName} was still ${status.state} after ${Math.round(timeoutMs / 1000)} seconds`, { code: 'WORKSPACE_UNAVAILABLE' });
    }
    await sleep(pollMs);
  }
}

// Only what gh needs: never the server's own environment (ENCRYPTION_KEY, database URL, ...).
function childEnv(token) {
  const env = { GH_TOKEN: token, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
  for (const name of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'SystemRoot']) if (process.env[name]) env[name] = process.env[name];
  return env;
}

// Runs `command` inside the codespace with `gh codespace ssh -c <name> -- bash -lc <command>`.
// No shell runs on this host: the arguments go to gh as they are, and only the codespace's own
// shell reads the command. Resolves to { stdout, stderr, exitCode, timedOut } for any exit code;
// rejects only when gh cannot be started.
function executeCommand(codespaceName, command, token, { timeoutMs = config.workspace.execTimeoutMs, ghPath = config.workspace.ghPath } = {}) {
  const name = requireName(codespaceName);
  if (typeof command !== 'string' || !command.trim()) return Promise.reject(new CodespacesError('a command is required', { code: 'BAD_INPUT' }));
  const args = ['codespace', 'ssh', '-c', name, '--', 'bash', '-lc', command];
  return new Promise((resolve, reject) => {
    childProcess.execFile(ghPath, args, { env: childEnv(token), timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        reject(new CodespacesError('the gh CLI is not installed on the server, so commands cannot run in a codespace', { code: 'WORKSPACE_UNAVAILABLE' }));
        return;
      }
      const timedOut = Boolean(err && err.killed);
      let exitCode = 0;
      if (err) exitCode = typeof err.code === 'number' ? err.code : 1;
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitCode, timedOut });
    });
  });
}

module.exports = { createCodespace, getCodespaceStatus, deleteCodespace, waitUntilAvailable, executeCommand, CodespacesError, childEnv };
