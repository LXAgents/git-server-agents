// Read-only tools for other threads in the same repository: issues, pull requests (merge
// requests on GitLab) with their diffs, and their commits. Another issue or PR is opened only
// when the commenter's own message mentions it (see references.js); this thread's own PR or MR
// needs no mention. Everything returned is repository data, never instructions.
const { platformOf } = require('./platform');
const { ToolInputError, parseNumber } = require('./threadActions');

const MAX_BODY_CHARS = 20_000;
const MAX_COMMENT_CHARS = 2_000;
const MAX_DIFF_CHARS = 40_000;
const MAX_COMMITS_SHOWN = 100;
const SHA = /^[0-9a-f]{7,40}$/;

function cut(text, max, what) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n[${what} truncated at ${max} characters of ${value.length}]`;
}

function header(label, item) {
  const lines = [`${label}: ${item.title}`, `State: ${item.state}. Author: @${item.author || 'unknown'}. ${item.url || ''}`.trim()];
  if (item.labels && item.labels.length) lines.push(`Labels: ${item.labels.join(', ')}`);
  if (item.head) lines.push(`Branches: ${item.head} into ${item.base}`);
  return lines;
}

function formatComments(comments) {
  if (!comments.length) return ['', 'No comments.'];
  return ['', `Last ${comments.length} comments, oldest first:`, ...comments.map((c) => `- @${c.author || 'unknown'}: ${cut(c.body, MAX_COMMENT_CHARS, 'comment')}`)];
}

// `refs` is findReferences() of the commenter's message; `thread` is this comment.
function createThreadReader({ platform, thread, token, refs }) {
  const api = platformOf(platform);
  const prefix = api.pullPrefix;
  const ownPull = thread.kind === 'pull_request' ? thread.number : null;
  const knownShas = new Set(refs.shas);
  const listed = new Map();

  function mentioned(kind, value, noun, symbol) {
    if (value === undefined || value === null || value === '') throw new ToolInputError(`a "number" is required`);
    const number = parseNumber(value);
    if (number === null) throw new ToolInputError(`"number" must be a positive number such as 12`);
    const allowed = kind === 'issue' ? refs.issues : refs.pulls;
    if ((number === thread.number && thread.kind === kind) || allowed.has(number)) return number;
    throw new ToolInputError(`${noun} ${symbol}${number} is not mentioned in the comment; only mentioned ones can be read`);
  }

  async function commitsOf(number) {
    if (!listed.has(number)) {
      const commits = await api.listPullCommits(thread, number, token);
      for (const c of commits) knownShas.add(c.sha.toLowerCase());
      listed.set(number, commits);
    }
    return listed.get(number);
  }

  // A sha the comment named, a listed commit of a PR it may read, or a commit of this PR.
  async function allowedSha(sha) {
    const matches = (known) => known === sha || known.startsWith(sha) || sha.startsWith(known);
    if ([...knownShas].some(matches)) return true;
    if (ownPull) await commitsOf(ownPull);
    return [...knownShas].some(matches);
  }

  async function readPullRequest(args) {
    const number = mentioned('pull_request', args.number, api.pullNoun, prefix);
    const pull = await api.readPullRequest(thread, number, token);
    const comments = await api.comments(thread, number, token, 'pull_request');
    const label = `${api.pullNoun.replace(/^./, (c) => c.toUpperCase())} ${prefix}${pull.number}`;
    return [
      ...header(label, pull),
      '',
      'Description:',
      cut(pull.body, MAX_BODY_CHARS, 'description') || '(none)',
      ...formatComments(comments),
      '',
      'Diff:',
      '```diff',
      cut(pull.diff, MAX_DIFF_CHARS, 'diff') || '(empty)',
      '```',
    ].join('\n');
  }

  const handlers = {
    async read_issue(args) {
      const number = mentioned('issue', args.number, 'issue', '#');
      const issue = await api.readIssue(thread, number, token);
      // On GitHub a mentioned #12 may be a pull request; read it as one.
      if (issue.isPull) return readPullRequest({ number });
      const comments = await api.comments(thread, number, token, 'issue');
      return [...header(`Issue #${issue.number}`, issue), '', 'Description:', cut(issue.body, MAX_BODY_CHARS, 'description') || '(none)', ...formatComments(comments)].join('\n');
    },

    read_pull_request: (args) => readPullRequest(args),

    async list_commits(args) {
      const given = args.number !== undefined && args.number !== null && args.number !== '';
      if (!given && !ownPull) throw new ToolInputError(`this comment is not on a ${api.pullNoun}, so give the ${api.pullNoun} "number"`);
      const number = given ? mentioned('pull_request', args.number, api.pullNoun, prefix) : ownPull;
      const commits = await commitsOf(number);
      if (!commits.length) return `${prefix}${number} has no commits.`;
      const shown = commits.slice(-MAX_COMMITS_SHOWN);
      const lines = [`${commits.length} commits on ${api.pullNoun} ${prefix}${number}, oldest first:`, ...shown.map((c) => `- ${c.sha.slice(0, 12)} ${c.title} (@${c.author || 'unknown'})`)];
      if (shown.length < commits.length) lines.push(`[the first ${commits.length - shown.length} commits are not shown]`);
      return lines.join('\n');
    },

    async read_commit(args) {
      const sha = typeof args.sha === 'string' ? args.sha.trim().toLowerCase() : '';
      if (!SHA.test(sha)) throw new ToolInputError('"sha" must be a commit sha of 7 to 40 hex characters');
      if (!(await allowedSha(sha))) {
        throw new ToolInputError(`commit ${sha} is not in this ${api.pullNoun}, a listed one or the comment; call list_commits first`);
      }
      const commit = await api.readCommit(thread, sha, token);
      return [`Commit ${commit.sha} by @${commit.author || 'unknown'}`, '', 'Message:', cut(commit.message, MAX_BODY_CHARS, 'message'), '', 'Diff:', '```diff', cut(commit.diff, MAX_DIFF_CHARS, 'diff') || '(empty)', '```'].join('\n');
    },
  };

  // Issues and other PRs only when the comment mentions one; commits also on this PR or MR.
  const names = [];
  if (refs.issues.size || refs.pulls.size) names.push('read_issue', 'read_pull_request');
  if (ownPull || refs.pulls.size || refs.shas.size) names.push('list_commits', 'read_commit');
  return Object.fromEntries(names.map((name) => [name, handlers[name]]));
}

module.exports = { createThreadReader, MAX_DIFF_CHARS };
