const test = require('node:test');
const assert = require('node:assert/strict');
const { toComment, REPLY_MARKER } = require('../src/services/eventService');

const repository = { full_name: 'acme/web' };

test('recognises a comment on a GitHub pull request', () => {
  const comment = toComment('github', 'issue_comment', {
    action: 'created',
    repository,
    issue: { number: 7, title: 'T', pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' } },
    comment: { body: 'hi', user: { type: 'User' } },
  });
  assert.equal(comment.kind, 'pull_request');
  assert.equal(comment.pullUrl, 'https://api.github.com/repos/acme/web/pulls/7');
  assert.equal(comment.number, 7);
});

test('recognises a comment on a GitHub issue', () => {
  const comment = toComment('github', 'issue_comment', {
    action: 'created',
    repository,
    issue: { number: 3, title: 'Bug' },
    comment: { body: 'hi', user: { type: 'User' } },
  });
  assert.equal(comment.kind, 'issue');
  assert.equal(comment.pullUrl, null);
});

test('ignores edits, bots, our own replies and other events', () => {
  const base = { repository, issue: { number: 1 }, comment: { body: 'hi', user: { type: 'User' } } };
  assert.equal(toComment('github', 'issue_comment', { ...base, action: 'edited' }), null);
  assert.equal(toComment('github', 'issue_comment', { ...base, action: 'created', comment: { body: 'hi', user: { type: 'Bot' } } }), null);
  assert.equal(toComment('github', 'issue_comment', { ...base, action: 'created', comment: { body: `x ${REPLY_MARKER}`, user: {} } }), null);
  assert.equal(toComment('github', 'pull_request', { ...base, action: 'created' }), null);
});

test('recognises a GitLab merge request note', () => {
  const comment = toComment('gitlab', 'note', {
    project: { id: 12 },
    user: { id: 7 },
    object_attributes: { note: 'hi', noteable_type: 'MergeRequest', action: 'create' },
    merge_request: { iid: 4, title: 'MR' },
  });
  assert.deepEqual(
    { kind: comment.kind, number: comment.number, projectId: comment.projectId },
    { kind: 'pull_request', number: 4, projectId: 12 }
  );
});

test('carries the branches when the payload has them', () => {
  const review = toComment('github', 'pull_request_review_comment', {
    action: 'created',
    repository,
    pull_request: { number: 7, url: 'u', head: { sha: 'abc', ref: 'fix/login' }, base: { ref: 'main' } },
    comment: { body: 'hi', user: { type: 'User' } },
  });
  assert.deepEqual({ headSha: review.headSha, headRef: review.headRef, baseRef: review.baseRef }, { headSha: 'abc', headRef: 'fix/login', baseRef: 'main' });
  const mr = toComment('gitlab', 'note', {
    project: { id: 12 },
    user: { id: 7 },
    object_attributes: { note: 'hi', noteable_type: 'MergeRequest', action: 'create' },
    merge_request: { iid: 4, title: 'MR', source_branch: 'feat/x', target_branch: 'develop' },
  });
  assert.deepEqual({ headRef: mr.headRef, baseRef: mr.baseRef }, { headRef: 'feat/x', baseRef: 'develop' });
});

test('ignores replies that carry the new or the pre-1.11.1 marker', () => {
  for (const marker of ['<!-- LXAgents -->', '<!-- git-server-agents -->']) {
    const comment = toComment('github', 'issue_comment', {
      action: 'created',
      repository,
      issue: { number: 3, title: 'Bug' },
      comment: { body: `@lxagents hi\n${marker}`, user: { type: 'User' } },
    });
    assert.equal(comment, null);
  }
});
