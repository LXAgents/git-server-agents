// Normalises a queued webhook payload into the one shape the agent works with, or null
// when the event is not a newly created comment on an issue, pull request or merge request.

// Every reply carries this marker, so the agent never answers itself even when its
// token belongs to a whitelisted user.
const REPLY_MARKER = '<!-- LXAgents -->';
// Error replies carry this as well, so they stay out of the conversation history.
const ERROR_MARKER = '<!-- LXAgents:error -->';
// Replies posted before 1.11.1 carry the old markers and must still be recognised.
const LEGACY_REPLY_MARKER = '<!-- git-server-agents -->';
const LEGACY_ERROR_MARKER = '<!-- git-server-agents:error -->';

function isReply(body) {
  const text = String(body || '');
  return text.includes(REPLY_MARKER) || text.includes(LEGACY_REPLY_MARKER);
}

function isErrorReply(body) {
  const text = String(body || '');
  return text.includes(ERROR_MARKER) || text.includes(LEGACY_ERROR_MARKER);
}

function removeMarkers(body) {
  return String(body || '').replace(REPLY_MARKER, '').replace(LEGACY_REPLY_MARKER, '');
}

function githubComment(event, body) {
  if (body.action !== 'created' || !body.comment || !body.repository) return null;
  const base = {
    platform: 'github',
    repo: body.repository.full_name,
    commentId: body.comment.id,
    commentBody: body.comment.body || '',
    author: (body.comment.user && body.comment.user.login) || '',
    isBot: (body.comment.user && body.comment.user.type === 'Bot') || false,
    // Files are read at the PR head when known, otherwise at the default branch.
    defaultBranch: body.repository.default_branch || null,
  };
  if (event === 'issue_comment' && body.issue) {
    const pullUrl = body.issue.pull_request && body.issue.pull_request.url;
    return {
      ...base,
      kind: pullUrl ? 'pull_request' : 'issue',
      number: body.issue.number,
      pullUrl: pullUrl || null,
      title: body.issue.title || '',
      description: body.issue.body || '',
    };
  }
  if (event === 'pull_request_review_comment' && body.pull_request) {
    return {
      ...base,
      kind: 'pull_request',
      // An inline review comment: its reactions live under /pulls/comments.
      review: true,
      number: body.pull_request.number,
      pullUrl: body.pull_request.url,
      headSha: (body.pull_request.head && body.pull_request.head.sha) || null,
      headRef: (body.pull_request.head && body.pull_request.head.ref) || null,
      baseRef: (body.pull_request.base && body.pull_request.base.ref) || null,
      title: body.pull_request.title || '',
      description: body.pull_request.body || '',
    };
  }
  return null;
}

function gitlabComment(event, body) {
  const attrs = body.object_attributes || {};
  if (event !== 'note' || !body.project) return null;
  if (attrs.action && attrs.action !== 'create') return null;
  const base = {
    platform: 'gitlab',
    projectId: body.project.id,
    // "group/project", to recognise links to this project in a comment.
    repoPath: body.project.path_with_namespace || null,
    commentId: attrs.id,
    commentBody: attrs.note || '',
    author: (body.user && body.user.username) || '',
    isBot: (body.user && body.user.bot) || false,
    defaultBranch: body.project.default_branch || null,
  };
  if (attrs.noteable_type === 'MergeRequest' && body.merge_request) {
    return {
      ...base,
      kind: 'pull_request',
      number: body.merge_request.iid,
      headSha: (body.merge_request.last_commit && body.merge_request.last_commit.id) || null,
      headRef: body.merge_request.source_branch || null,
      baseRef: body.merge_request.target_branch || null,
      title: body.merge_request.title || '',
      description: body.merge_request.description || '',
    };
  }
  if (attrs.noteable_type === 'Issue' && body.issue) {
    return {
      ...base,
      kind: 'issue',
      number: body.issue.iid,
      title: body.issue.title || '',
      description: body.issue.description || '',
    };
  }
  return null;
}

function toComment(platform, event, payload) {
  const comment = platform === 'github' ? githubComment(event, payload) : gitlabComment(event, payload);
  if (!comment || comment.isBot || isReply(comment.commentBody)) return null;
  return comment;
}

module.exports = { toComment, isReply, isErrorReply, removeMarkers, REPLY_MARKER, ERROR_MARKER };
