// Reading other issues, pull requests and commits: only what the comment mentions.
const test = require('node:test');
const assert = require('node:assert/strict');

const github = require('../src/services/platforms/githubService');
const gitlab = require('../src/services/platforms/gitlabService');
const { findReferences } = require('../src/services/agent/references');
const { createThreadReader } = require('../src/services/agent/threadReader');
const { createRepoTools } = require('../src/services/agent/repoTools');

const set = (refs) => ({ issues: [...refs.issues], pulls: [...refs.pulls], shas: [...refs.shas] });

test('mentions: GitHub #N, GH-N and links into this repository only', () => {
  const text = 'See #12 and GH-7, https://github.com/acme/web/pull/30 and https://github.com/acme/web/issues/31, not https://github.com/other/x/issues/99, C#5 or a&#38; also abc1234f';
  assert.deepEqual(set(findReferences(text, { platform: 'github', repoPath: 'acme/web' })), {
    issues: [12, 7, 30, 31],
    pulls: [12, 7, 30, 31],
    shas: ['abc1234f'],
  });
  assert.deepEqual(set(findReferences('nothing here, deadbeef, 1234567', { platform: 'github', repoPath: 'acme/web' })), { issues: [], pulls: [], shas: [] });
  const commitLink = findReferences('https://github.com/acme/web/pull/3/commits/0123456789abcdef0123456789abcdef01234567', { platform: 'github', repoPath: 'acme/web' });
  assert.ok(commitLink.shas.has('0123456789abcdef0123456789abcdef01234567'));
});

test('mentions: GitHub !N is an issue only', () => {
  assert.deepEqual(set(findReferences('What !1 about? and #5', { platform: 'github', repoPath: 'acme/web' })), { issues: [5, 1], pulls: [5], shas: [] });
  assert.deepEqual(set(findReferences('wow!1 a!!2', { platform: 'github', repoPath: 'acme/web' })), { issues: [], pulls: [], shas: [] });
});

test('the tool guide explains the mention syntax of each platform', () => {
  const { buildToolGuide } = require('../src/services/agent/prompt');
  const guide = (platform) => buildToolGuide({ rounds: 3, thread: { platform }, readTools: ['read_issue'] });
  assert.match(guide('github'), /!12 is issue 12; #12 is pull request 12, or issue 12/);
  assert.match(guide('gitlab'), /#12 is issue 12 and !12 is merge request 12/);
  assert.match(guide('github'), /answer about that one, not this thread/);
});

test('mentions: GitLab #N is an issue and !N a merge request', () => {
  const text = 'compare #4 with !9, https://gitlab.com/grp/app/-/merge_requests/11 and https://gitlab.com/grp/app/-/issues/12';
  assert.deepEqual(set(findReferences(text, { platform: 'gitlab', repoPath: 'grp/app' })), { issues: [4, 12], pulls: [9, 11], shas: [] });
});

const prThread = { kind: 'pull_request', number: 8, repo: 'acme/web', projectId: 12 };
const issueThread = { kind: 'issue', number: 3, repo: 'acme/web', projectId: 12 };
const readerFor = (text, thread = issueThread, platform = 'github') =>
  createThreadReader({ platform, thread, token: 't', refs: findReferences(text, { platform, repoPath: 'acme/web' }) });

function stubGithub(t) {
  t.mock.method(github, 'getIssue', async (_r, number) => ({ number, title: `Issue ${number}`, state: 'open', author: 'bob', labels: ['bug'], body: 'Broken', url: `u/${number}`, isPull: number === 30 }));
  t.mock.method(github, 'getPullByNumber', async (_r, number) => ({ number, title: `PR ${number}`, state: 'open', author: 'carol', labels: [], body: 'Fixes', url: `p/${number}`, head: 'fix/x', base: 'main', apiUrl: `api/${number}` }));
  t.mock.method(github, 'getPullDiff', async () => 'diff --git a/x b/x\n+fixed');
  t.mock.method(github, 'listIssueComments', async () => [{ author: 'dave', body: 'Same here' }]);
  t.mock.method(github, 'listPullCommits', async (_r, number) => [
    { sha: `aaaaaaa${number}000000000000000000000000000000`.slice(0, 40), title: 'first', author: 'carol' },
    { sha: '1234567890abcdef1234567890abcdef12345678', title: 'second', author: 'carol' },
  ]);
  t.mock.method(github, 'getCommit', async (_r, sha) => ({ sha, message: 'second\n\nbody', author: 'carol', diff: 'diff --git a/y b/y\n+y' }));
}

test('the read tools are offered only when something is mentioned, or for commits on a PR', () => {
  assert.deepEqual(Object.keys(readerFor('what is this?')), []);
  assert.deepEqual(Object.keys(readerFor('compare with #12')), ['read_issue', 'read_pull_request', 'list_commits', 'read_commit']);
  assert.deepEqual(Object.keys(readerFor('explain the commits', prThread)), ['read_pull_request', 'list_commits', 'read_commit']);
  const tools = createRepoTools({ platform: 'github', repo: 'acme/web', ref: 'abc', token: 't' }, { reader: readerFor('see #12') }).tools;
  assert.deepEqual(tools.map((tool) => tool.function.name), ['list_files', 'read_file', 'read_issue', 'read_pull_request', 'list_commits', 'read_commit']);
});

test('a PR reads itself without a mention or a number', async (t) => {
  stubGithub(t);
  const reader = readerFor('which branch is this?', prThread);
  assert.match(await reader.read_pull_request({}), /^Pull request #8: PR 8\n.*\nBranches: fix\/x into main\n/s);
  assert.match(await reader.read_pull_request({ number: 8 }), /^Pull request #8/);
  await assert.rejects(reader.read_pull_request({ number: 9 }), /#9 is not mentioned/);
  await assert.rejects(readerFor('see #12').read_pull_request({}), /a "number" is required/);
});

test('an issue reads a mentioned issue and a mentioned PR with its diff, and nothing else', async (t) => {
  stubGithub(t);
  const reader = readerFor('Is #12 the same bug? Does PR #30 fix it?');
  const issue = await reader.read_issue({ number: 12 });
  assert.match(issue, /^Issue #12: Issue 12\nState: open\. Author: @bob\. u\/12\nLabels: bug\n\nDescription:\nBroken\n\nLast 1 comments, oldest first:\n- @dave: Same here$/);
  const viaIssue = await reader.read_issue({ number: 30 });
  assert.match(viaIssue, /^Pull request #30: PR 30\n/);
  assert.match(viaIssue, /Branches: fix\/x into main/);
  assert.match(viaIssue, /```diff\ndiff --git a\/x b\/x\n\+fixed\n```$/);
  assert.equal(github.getPullDiff.mock.calls[0].arguments[0], 'api/30');
  await assert.rejects(reader.read_issue({ number: 99 }), /issue #99 is not mentioned in the comment/);
  await assert.rejects(reader.read_pull_request({ number: 31 }), /pull request #31 is not mentioned/);
  const tools = createRepoTools({ platform: 'github', repo: 'acme/web', ref: 'abc', token: 't' }, { reader });
  assert.match(await tools.run('read_issue', '{"number":99}'), /^Error: read_issue: issue #99 is not mentioned/);
});

test('a PR lists its own commits without a mention and reads only known commits', async (t) => {
  stubGithub(t);
  const reader = readerFor('what changed in the second commit?', prThread);
  assert.match(await reader.list_commits({}), /^2 commits on pull request #8, oldest first:\n- aaaaaaa80000 first \(@carol\)\n- 1234567890ab second \(@carol\)$/);
  assert.match(await reader.read_commit({ sha: '1234567890ab' }), /^Commit 1234567890ab by @carol\n\nMessage:\nsecond\n\nbody\n\nDiff:\n```diff\ndiff --git a\/y b\/y\n\+y\n```$/);
  await assert.rejects(reader.read_commit({ sha: 'fedcba9876543' }), /not in this pull request, a listed one or the comment/);
  await assert.rejects(reader.read_commit({ sha: 'xyz' }), /7 to 40 hex/);
  await assert.rejects(reader.list_commits({ number: 5 }), /#5 is not mentioned/);
  // read_commit before list_commits still works for this PR's own commits.
  const fresh = readerFor('read 1234567890abcdef', prThread);
  t.mock.method(github, 'getCommit', async (_r, sha) => ({ sha, message: 'm', author: 'a', diff: '' }));
  assert.match(await fresh.read_commit({ sha: '1234567890abcdef' }), /Commit 1234567890abcdef/);
});

test('an issue thread lists commits only of a mentioned PR', async (t) => {
  stubGithub(t);
  await assert.rejects(readerFor('see #30').list_commits({}), /not on a pull request, so give the pull request "number"/);
  assert.match(await readerFor('see #30').list_commits({ number: 30 }), /2 commits on pull request #30/);
});

test('GitLab reads mentioned issues and merge requests through the project', async (t) => {
  t.mock.method(gitlab, 'getIssue', async (_p, number) => ({ number, title: 'I', state: 'open', author: 'carol', labels: [], body: '', url: 'u', isPull: false }));
  t.mock.method(gitlab, 'getMergeRequest', async (_p, number) => ({ number, title: 'M', state: 'merged', author: 'dave', labels: [], body: 'B', url: 'm', head: 'feat/x', base: 'main' }));
  t.mock.method(gitlab, 'getMergeRequestDiff', async () => 'diff --git a/z b/z');
  t.mock.method(gitlab, 'listNotes', async () => []);
  const reader = readerFor('is #4 fixed by !9?', issueThread, 'gitlab');
  assert.match(await reader.read_issue({ number: 4 }), /^Issue #4: I\n.*\n\nDescription:\n\(none\)\n\nNo comments\.$/);
  assert.match(await reader.read_pull_request({ number: 9 }), /^Merge request !9: M\nState: merged/);
  assert.deepEqual(gitlab.listNotes.mock.calls.map((c) => c.arguments.slice(0, 3)), [[12, 'issue', 4], [12, 'pull_request', 9]]);
  await assert.rejects(reader.read_issue({ number: 9 }), /issue #9 is not mentioned/);
  await assert.rejects(reader.read_pull_request({ number: 4 }), /merge request !4 is not mentioned/);
});
