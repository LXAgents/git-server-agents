// The changes the agent may make on the platform for a commenter with write access: create,
// close and reopen issues and pull requests (merge requests on GitLab). Each action checks its
// arguments and returns text for the model; platform failures are thrown and turned into text
// by repoTools.
const { platformOf } = require('./platform');

const MAX_TITLE_CHARS = 256;
const MAX_BODY_CHARS = 60_000;
const MAX_LABELS = 10;

// A thrown input problem, shown to the model as it is so it can fix the call.
class ToolInputError extends Error {}

function requireTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw new ToolInputError('a non-empty "title" is required');
  if (title.length > MAX_TITLE_CHARS) throw new ToolInputError(`"title" is longer than ${MAX_TITLE_CHARS} characters`);
  return title;
}

function optionalBody(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ToolInputError('"body" must be a string');
  if (value.length > MAX_BODY_CHARS) throw new ToolInputError(`"body" is longer than ${MAX_BODY_CHARS} characters`);
  return value;
}

function optionalLabels(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((l) => typeof l !== 'string' || !l.trim())) throw new ToolInputError('"labels" must be a list of label names');
  if (value.length > MAX_LABELS) throw new ToolInputError(`at most ${MAX_LABELS} labels`);
  return value.map((l) => l.trim());
}

// A branch name as git allows it, roughly: no spaces or control characters, none of ~^:?*[\,
// no "..", "//" or "@{", and no leading "/" or trailing "/" or ".".
const BRANCH_FORBIDDEN = new Set(['~', '^', ':', '?', '*', '[', '\\']);
function validBranch(name) {
  if (name.length > 255 || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
  if (['..', '//', '@{'].some((part) => name.includes(part))) return false;
  return ![...name].some((ch) => ch.codePointAt(0) <= 0x20 || ch.codePointAt(0) === 0x7f || BRANCH_FORBIDDEN.has(ch));
}

function branchName(value, field, fallback) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) {
    if (fallback) return fallback;
    throw new ToolInputError(`a "${field}" branch name is required`);
  }
  if (!validBranch(name)) throw new ToolInputError(`"${field}" is not a valid branch name`);
  return name;
}

// "12", 12, "#12" and "!12" all mean 12.
function parseNumber(value) {
  const text = String(value).trim().replace(/^[#!]/, '');
  return /^\d{1,9}$/.test(text) && Number(text) > 0 ? Number(text) : null;
}

// The issue or pull request number: the one given, or this thread's when it is the same kind.
function targetNumber(value, thread, kind, noun) {
  if (value !== undefined && value !== null && value !== '') {
    const number = parseNumber(value);
    if (number === null) throw new ToolInputError(`"number" must be a positive ${noun} number such as 12`);
    return number;
  }
  if (thread.kind === kind) return thread.number;
  throw new ToolInputError(`this comment is not on ${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}, so give the ${noun} "number"`);
}

// Who asked, under everything the agent opens, so the platform shows the bot as the author but
// readers still see the person. The login is in a code span, so nobody is notified.
function attribution(body, asker) {
  const line = `<sub>Opened by LXAgents for \`@${String(asker || 'unknown').replaceAll('`', '')}\`</sub>`;
  return body ? `${body}\n\n${line}` : line;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// `thread` is the comment from eventService.toComment: { kind, number, repo, projectId, ... }.
function createThreadActions({ platform, thread, token, asker }) {
  const api = platformOf(platform);

  async function setIssue(args, state) {
    const number = targetNumber(args.number, thread, 'issue', 'issue');
    const issue = await api.setIssueState(thread, number, state, token);
    return `Issue #${issue.number} is now ${issue.state}: ${issue.url}`;
  }

  async function setPull(args, state) {
    const number = targetNumber(args.number, thread, 'pull_request', api.pullNoun);
    const pull = await api.setPullRequestState(thread, number, state, token);
    return `${capitalize(api.pullNoun)} ${api.pullPrefix}${pull.number} is now ${pull.state}: ${pull.url}`;
  }

  return {
    async create_issue(args) {
      const fields = { title: requireTitle(args.title), body: attribution(optionalBody(args.body), asker), labels: optionalLabels(args.labels) };
      const issue = await api.createIssue(thread, fields, token);
      return `Created issue #${issue.number}: ${issue.url}`;
    },
    close_issue: (args) => setIssue(args, 'closed'),
    reopen_issue: (args) => setIssue(args, 'open'),
    async create_pull_request(args) {
      const head = branchName(args.head, 'head');
      const base = branchName(args.base, 'base', thread.defaultBranch);
      if (head === base) throw new ToolInputError('"head" and "base" must be different branches');
      if (args.draft !== undefined && typeof args.draft !== 'boolean') throw new ToolInputError('"draft" must be true or false');
      const fields = { title: requireTitle(args.title), body: attribution(optionalBody(args.body), asker), head, base, draft: args.draft === true };
      const pull = await api.createPullRequest(thread, fields, token);
      return `Created ${api.pullNoun} ${api.pullPrefix}${pull.number} (${head} into ${base}): ${pull.url}`;
    },
    close_pull_request: (args) => setPull(args, 'closed'),
    reopen_pull_request: (args) => setPull(args, 'open'),
  };
}

module.exports = { createThreadActions, ToolInputError, parseNumber };
