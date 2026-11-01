// The model's tools. Two read the repository the comment was made in, through the GitHub or
// GitLab REST APIs (never a clone); models without tool support get that context added to the
// prompt instead. The read-thread tools open issues, pull requests and commits the comment
// mentions. The manage tools change issues and pull requests, and are offered only to
// commenters with write access (see membership.canManage and threadActions).
const { trimTrailingSlashes } = require('../../utils/strings');
const { platformOf } = require('./platform');
const { ToolInputError } = require('./threadActions');
const { WORKSPACE_TOOLS } = require('./workspaceTools');

const MAX_FILE_CHARS = 40_000;
const MAX_TREE_PATHS = 2_000;
const MAX_INLINE_FILES = 3;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List file paths in the repository at the commit being discussed. Optionally only under a folder.',
      parameters: {
        type: 'object',
        properties: { folder: { type: 'string', description: 'Folder path such as "src/services". Omit for the whole repository.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the content of one file in the repository at the commit being discussed.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path from list_files, e.g. "src/app.js".' } },
        required: ['path'],
      },
    },
  },
];

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, ...(required.length ? { required } : {}) } },
});

const NUMBER_ARG = (noun) => ({
  type: 'integer',
  description: `The ${noun} number, e.g. 12 for #12. Omit it to mean the ${noun} this comment was made on.`,
});

const ISSUE_TOOLS = [
  fn(
    'create_issue',
    'Open a new issue in this repository. Use it only when the commenter asks for an issue to be created.',
    {
      title: { type: 'string', description: 'The issue title, one line.' },
      body: { type: 'string', description: 'The issue description in Markdown.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Existing label names to add. Optional.' },
    },
    ['title']
  ),
  fn('close_issue', 'Close an issue. Use it only when the commenter asks for the issue to be closed.', { number: NUMBER_ARG('issue') }),
  fn('reopen_issue', 'Reopen a closed issue. Use it only when the commenter asks for the issue to be reopened.', { number: NUMBER_ARG('issue') }),
];
// GitLab calls them merge requests; the adapter maps these to its merge request endpoints.
const PULL_REQUEST_TOOLS = [
  fn(
    'create_pull_request',
    'Open a pull request (a merge request on GitLab) from an existing branch. It does not create branches or commits. Use it only when the commenter asks for one.',
    {
      title: { type: 'string', description: 'The pull request title, one line.' },
      head: { type: 'string', description: 'An existing branch in this repository with the changes, e.g. "fix/login".' },
      base: { type: 'string', description: 'The branch to merge into. Omit it for the default branch.' },
      body: { type: 'string', description: 'The pull request description in Markdown.' },
      draft: { type: 'boolean', description: 'Open it as a draft. Default false.' },
    },
    ['title', 'head']
  ),
  fn('close_pull_request', 'Close a pull request (merge request on GitLab) without merging it. Use it only when the commenter asks.', {
    number: NUMBER_ARG('pull request'),
  }),
  fn('reopen_pull_request', 'Reopen a closed, unmerged pull request (merge request on GitLab). Use it only when the commenter asks.', {
    number: NUMBER_ARG('pull request'),
  }),
];
const MANAGE_TOOLS = [...ISSUE_TOOLS, ...PULL_REQUEST_TOOLS];

// Read-only tools for other threads, offered only when the comment mentions one (or, for the
// commit tools, on a pull request). See threadReader.
const READ_THREAD_TOOLS = [
  fn(
    'read_issue',
    'Read an issue the commenter mentioned (e.g. !12 or #12 on GitHub, #12 on GitLab): title, state, description and its last comments. On GitHub a pull request number works too.',
    { number: { type: 'integer', description: 'The mentioned issue number, e.g. 12 for !12 or #12.' } },
    ['number']
  ),
  fn(
    'read_pull_request',
    'Read a pull request (merge request on GitLab) the commenter mentioned, or this one: title, state, branches, description, last comments and its diff.',
    { number: { type: 'integer', description: 'The pull request number, e.g. 12 for #12 (!12 on GitLab). Leave it out for this one.' } }
  ),
  fn('list_commits', 'List the commits of this pull request (merge request on GitLab), or of one the commenter mentioned: sha, title and author, oldest first.', {
    number: NUMBER_ARG('pull request'),
  }),
  fn(
    'read_commit',
    'Read one commit\'s message and diff. The sha must come from list_commits, or be named in the comment.',
    { sha: { type: 'string', description: 'The commit sha, 7 to 40 hex characters.' } },
    ['sha']
  ),
];

// The platform's own reason for a refusal, short enough for one tool result.
function platformMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  const parts = [data.message, data.error, ...(Array.isArray(data.errors) ? data.errors.map((e) => e.message || e.code) : [])];
  const text = parts
    .filter(Boolean)
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join('; ');
  return text.slice(0, 300);
}

// A failed tool as text for the model, so it can fix the call or explain the failure.
function failureText(name, err) {
  if (err instanceof ToolInputError || err.notIssue) return `Error: ${name}: ${err.message}.`;
  const res = err.response;
  if (!res) return `Error: ${name} failed (${err.message}).`;
  const detail = platformMessage(res.data);
  const hint = res.status === 403 || res.status === 401 ? ' The app may lack the permission for this.' : '';
  return `Error: ${name} failed (HTTP ${res.status}${detail ? `: ${detail}` : ''}).${hint}`;
}

function cleanPath(path) {
  return trimTrailingSlashes(
    String(path || '')
      .trim()
      .replace(/^\.?\/+/, '')
  );
}

// `source` is { platform, repo, projectId, ref, token }. `actions` are the manage tools'
// handlers from threadActions, or null when the commenter may only read. `reader` holds the
// thread-reading handlers from threadReader that this comment allows. `workspace` holds the
// workspace tools' handlers (workspaceTools), or null when they are not offered.
function createRepoTools(source, { actions = null, reader = null, workspace = null } = {}) {
  const api = platformOf(source.platform);
  let treePromise = null;

  const tree = () => {
    if (!treePromise) {
      treePromise = api.getRepoTree(source);
    }
    return treePromise;
  };

  async function listFiles(folder) {
    const { paths, truncated } = await tree();
    const prefix = cleanPath(folder);
    const matched = prefix ? paths.filter((p) => p === prefix || p.startsWith(`${prefix}/`)) : paths;
    if (matched.length === 0) return prefix ? `No files under "${prefix}".` : 'The repository has no files.';
    const shown = matched.slice(0, MAX_TREE_PATHS);
    const notes = [];
    if (matched.length > shown.length) notes.push(`[${matched.length - shown.length} more paths not shown]`);
    if (truncated) notes.push('[the platform returned a partial tree]');
    return [`${matched.length} files at ${source.ref}:`, ...shown, ...notes].join('\n');
  }

  async function readFile(path) {
    const clean = cleanPath(path);
    if (!clean) return 'Error: a file path is required.';
    const content = await api.getFileContent(source, clean);
    if (content === null || content === undefined) return `Error: ${clean} was not found at ${source.ref}.`;
    if (String(content).includes('\u0000')) return `Error: ${clean} is a binary file.`;
    const text = String(content);
    if (text.length <= MAX_FILE_CHARS) return text;
    return `${text.slice(0, MAX_FILE_CHARS)}\n\n[${clean} truncated at ${MAX_FILE_CHARS} characters of ${text.length}]`;
  }

  async function run(name, rawArgs) {
    let args = {};
    try {
      args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
    } catch {
      return 'Error: the tool arguments were not valid JSON.';
    }
    try {
      if (name === 'list_files') return await listFiles(args.folder);
      if (name === 'read_file') return await readFile(args.path);
      if (reader && Object.hasOwn(reader, name)) return await reader[name](args || {});
      if (actions && Object.hasOwn(actions, name)) return await actions[name](args || {});
      if (workspace && Object.hasOwn(workspace, name)) return await workspace[name](args || {});
      return `Error: unknown tool ${name}.`;
    } catch (err) {
      return failureText(name, err);
    }
  }

  // For models without tools: the file tree, plus files whose paths the question names.
  async function inlineContext(question) {
    const sections = [];
    let paths = [];
    try {
      paths = (await tree()).paths;
      sections.push(`Repository files:\n${await listFiles('')}`);
    } catch (err) {
      sections.push(`(The file list could not be read: ${(err.response && err.response.status) || err.message}.)`);
    }
    const text = String(question || '');
    const named = paths.filter((p) => text.includes(p) || (p.includes('/') && new RegExp(`(^|[\\s\`'"(])${escapeRe(p.split('/').pop())}([\\s\`'".,:;)?!]|$)`).test(text)));
    for (const path of named.sort((a, b) => b.length - a.length).slice(0, MAX_INLINE_FILES)) {
      sections.push(`File ${path}:\n\`\`\`\n${await readFile(path)}\n\`\`\``);
    }
    return sections.join('\n\n');
  }

  const offered = (handlers, list) => (handlers ? list.filter((t) => Object.hasOwn(handlers, t.function.name)) : []);
  const tools = [...TOOLS, ...offered(reader, READ_THREAD_TOOLS), ...offered(actions, MANAGE_TOOLS), ...offered(workspace, WORKSPACE_TOOLS)];
  return { tools, run, listFiles, readFile, inlineContext };
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { TOOLS, MANAGE_TOOLS, READ_THREAD_TOOLS, createRepoTools, failureText, MAX_FILE_CHARS, MAX_TREE_PATHS };
