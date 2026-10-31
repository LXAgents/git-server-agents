// Read-only access to the repository the comment was made in, through the GitHub or GitLab
// REST APIs (never a clone). The model reaches it through two tools; models without tool
// support get the same context added to the prompt instead.
const github = require('./githubService');
const gitlab = require('./gitlabService');

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

function cleanPath(path) {
  return String(path || '')
    .trim()
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '');
}

// `source` is { platform, repo, projectId, ref, token }.
function createRepoTools(source) {
  let treePromise = null;

  const tree = () => {
    if (!treePromise) {
      treePromise =
        source.platform === 'github'
          ? github.getRepoTree(source.repo, source.ref, source.token)
          : gitlab.getRepoTree(source.projectId, source.ref);
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
    const content =
      source.platform === 'github'
        ? await github.getFileContent(source.repo, clean, source.ref, source.token)
        : await gitlab.getFileContent(source.projectId, clean, source.ref);
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
      return `Error: unknown tool ${name}.`;
    } catch (err) {
      return `Error: ${name} failed (${(err.response && err.response.status) || err.message}).`;
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

  return { run, listFiles, readFile, inlineContext };
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { TOOLS, createRepoTools, MAX_FILE_CHARS, MAX_TREE_PATHS };
