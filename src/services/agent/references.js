// The issues, pull requests and commits the commenter's own message points at. The read tools
// only open these (and this thread), so nothing in a file, diff or earlier comment can steer the
// agent into other threads. Other repositories are never matched.
//   GitHub: #12, GH-12, https://github.com/owner/repo/issues/12 or /pull/12
//   GitLab: #12 (issue), !12 (merge request), https://gitlab.com/group/project/-/issues/12
//           or /-/merge_requests/12
//   Both:   a commit sha of 7 to 40 hex characters, or a link to /commit/<sha>
const MAX_NUMBER = 999_999_999;

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const toNumber = (text) => {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 && n <= MAX_NUMBER ? n : null;
};

function collect(text, pattern, into, group = 1) {
  for (const match of text.matchAll(pattern)) {
    const value = group === 'sha' ? match[1].toLowerCase() : toNumber(match[group]);
    if (value !== null) into.add(value);
  }
}

// `repoPath` is "owner/repo" on GitHub and "group/project" on GitLab.
// Returns { issues, pulls, shas }: Sets of numbers (and lower-case shas).
function findReferences(text, { platform, repoPath }) {
  const body = String(text || '');
  const issues = new Set();
  const pulls = new Set();
  const shas = new Set();
  const path = repoPath ? escapeRe(String(repoPath)) : null;

  if (platform === 'github') {
    // GitHub numbers issues and pull requests together, so #12 may be either.
    const both = new Set();
    collect(body, /(?:^|[^\w&/#])(?:#|GH-)(\d{1,9})\b/gi, both);
    if (path) collect(body, new RegExp(`https?://[^\\s/]+/${path}/(?:issues|pull)/(\\d{1,9})\\b`, 'gi'), both);
    for (const n of both) {
      issues.add(n);
      pulls.add(n);
    }
  } else {
    collect(body, /(?:^|[^\w&/#])#(\d{1,9})\b/g, issues);
    collect(body, /(?:^|[^\w&/!])!(\d{1,9})\b/g, pulls);
    if (path) {
      collect(body, new RegExp(`https?://[^\\s/]+/${path}/-/issues/(\\d{1,9})\\b`, 'gi'), issues);
      collect(body, new RegExp(`https?://[^\\s/]+/${path}/-/merge_requests/(\\d{1,9})\\b`, 'gi'), pulls);
    }
  }
  // A bare sha needs a digit and a letter, so words like "deadbeef" or numbers alone don't count.
  for (const match of body.matchAll(/(?:^|[^\w/])([0-9a-f]{7,40})\b/gi)) {
    if (/\d/.test(match[1]) && /[a-f]/i.test(match[1])) shas.add(match[1].toLowerCase());
  }
  if (path) collect(body, new RegExp(`https?://[^\\s/]+/${path}/(?:-/)?(?:(?:pull|merge_requests)/\\d+/(?:-/)?)?commits?/([0-9a-f]{7,40})\\b`, 'gi'), shas, 'sha');
  return { issues, pulls, shas };
}

const hasReferences = (refs) => refs.issues.size + refs.pulls.size + refs.shas.size > 0;

module.exports = { findReferences, hasReferences };
