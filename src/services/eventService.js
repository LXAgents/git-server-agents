// Normalises a queued webhook payload into the one shape the agent works with, or null
// when the event is not a newly created comment on an issue, pull request or merge request.

// Every reply carries this marker, so the agent never answers itself even when its
// token belongs to a whitelisted user.
const REPLY_MARKER = '<!-- git-server-agents -->';

function githubComment(event, body) {
  if (body.action !== 'created' || !body.comment || !body.repository) return null;
  const base = {
    platform: 'github',
    repo: body.repository.full_name,
    commentBody: body.comment.body || '',
    isBot: (body.comment.user && body.comment.user.type === 'Bot') || false,
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
      number: body.pull_request.number,
      pullUrl: body.pull_request.url,
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
    commentBody: attrs.note || '',
    isBot: (body.user && body.user.bot) || false,
  };
  if (attrs.noteable_type === 'MergeRequest' && body.merge_request) {
    return {
      ...base,
      kind: 'pull_request',
      number: body.merge_request.iid,
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
  if (!comment || comment.isBot || comment.commentBody.includes(REPLY_MARKER)) return null;
  return comment;
}

module.exports = { toComment, REPLY_MARKER };
