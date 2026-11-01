// Everything the agent asks GitHub or GitLab, behind one shape per platform, so the agent's
// flow never branches on the platform. `c` is the comment from eventService.toComment.
const github = require('../platforms/githubService');
const gitlab = require('../platforms/gitlabService');
const { githubIdentity, gitlabIdentity } = require('../platforms/identityService');

// Who owns the GitHub repository the webhook came from: { id, type }.
function githubAccount(payload) {
  return (payload.repository && payload.repository.owner) || (payload.installation && payload.installation.account) || {};
}

const GITLAB_DEVELOPER = 30;

const adapters = {
  github: {
    name: 'GitHub',
    identity: githubIdentity,
    // GitHub calls are made with the App installation's token; GitLab uses the bot token.
    needsToken: true,
    token: (installationId) => github.installationToken(installationId),
    acknowledge: (c, token) => github.addReaction(c.repo, c.commentId, { review: Boolean(c.review) }, token),
    diff: (c, token) => (c.pullUrl ? github.getPullDiff(c.pullUrl, token) : ''),
    history: (c, token) => github.listIssueComments(c.repo, c.number, token),
    postReply: (c, body, token) => github.postComment(c.repo, c.number, body, token),
    // Where files are read (the PR head, or the default branch for an issue) and, on a PR, its
    // branches. A comment on the PR conversation carries neither, so the PR is fetched.
    async resolveSource(c, token) {
      if (!c.pullUrl) return { ref: c.defaultBranch, head: null, base: null };
      if (c.headSha && c.headRef) return { ref: c.headSha, head: c.headRef, base: c.baseRef || null };
      const pull = await github.getPull(c.pullUrl, token);
      const head = pull.head || {};
      return { ref: c.headSha || head.sha || c.defaultBranch, head: head.ref || null, base: (pull.base && pull.base.ref) || null };
    },
    async isOrgMember(identity, payload, token) {
      const account = githubAccount(payload);
      const isOrganization = Boolean(payload.organization) || account.type === 'Organization';
      // A personal account: only its owner counts.
      if (!isOrganization) return String(account.id) === String(identity.triggerUserId);
      return github.isOrgMember(identity.targetOrg, identity.triggerUser, token);
    },
    isRepoMember: (identity, c, token) => github.isCollaborator(c.repo, identity.triggerUser, token),
    getRepoTree: (source) => github.getRepoTree(source.repo, source.ref, source.token),
    getFileContent: (source, path) => github.getFileContent(source.repo, path, source.ref, source.token),
    // Changing issues and pull requests needs write access (write, maintain or admin).
    async canWrite(identity, c, token) {
      const permission = await github.getCollaboratorPermission(c.repo, identity.triggerUser, token);
      return permission === 'admin' || permission === 'write';
    },
    createIssue: (c, fields, token) => github.createIssue(c.repo, fields, token),
    setIssueState: (c, number, state, token) => github.setIssueState(c.repo, number, state, { reason: state === 'closed' ? 'completed' : undefined }, token),
    pullNoun: 'pull request',
    pullPrefix: '#',
    createPullRequest: (c, fields, token) => github.createPullRequest(c.repo, fields, token),
    setPullRequestState: (c, number, state, token) => github.setPullRequestState(c.repo, number, state, token),
    repoPath: (c) => c.repo,
    readIssue: (c, number, token) => github.getIssue(c.repo, number, token),
    async readPullRequest(c, number, token) {
      const pull = await github.getPullByNumber(c.repo, number, token);
      return { ...pull, diff: await github.getPullDiff(pull.apiUrl, token) };
    },
    comments: (c, number, token) => github.listIssueComments(c.repo, number, token, { limit: 10, maxPages: 3 }),
    listPullCommits: (c, number, token) => github.listPullCommits(c.repo, number, token),
    readCommit: (c, sha, token) => github.getCommit(c.repo, sha, token),
  },
  gitlab: {
    name: 'GitLab',
    identity: gitlabIdentity,
    needsToken: false,
    token: async () => undefined,
    acknowledge: (c) => gitlab.awardEmoji(c.projectId, c.kind, c.number, c.commentId),
    diff: (c) => (c.kind === 'pull_request' ? gitlab.getMergeRequestDiff(c.projectId, c.number) : ''),
    history: (c) => gitlab.listNotes(c.projectId, c.kind, c.number),
    postReply: (c, body) => gitlab.postNote(c.projectId, c.kind, c.number, body),
    resolveSource: async (c) => ({ ref: c.headSha || c.defaultBranch, head: c.headRef || null, base: c.baseRef || null }),
    async isOrgMember(identity) {
      if (await gitlab.groupExists(identity.targetOrg)) return gitlab.isGroupMember(identity.targetOrg, identity.triggerUserId);
      // A personal namespace: only its owner counts.
      return String(identity.targetOrg).toLowerCase() === String(identity.triggerUser || '').toLowerCase();
    },
    isRepoMember: (identity, c) => gitlab.isProjectMember(c.projectId, identity.triggerUserId),
    getRepoTree: (source) => gitlab.getRepoTree(source.projectId, source.ref),
    getFileContent: (source, path) => gitlab.getFileContent(source.projectId, path, source.ref),
    // Developer (30) or above may change issues and merge requests.
    canWrite: async (identity, c) => (await gitlab.getMemberAccessLevel(c.projectId, identity.triggerUserId)) >= GITLAB_DEVELOPER,
    createIssue: (c, fields) => gitlab.createIssue(c.projectId, fields),
    setIssueState: (c, number, state) => gitlab.setIssueState(c.projectId, number, state),
    pullNoun: 'merge request',
    pullPrefix: '!',
    createPullRequest: (c, fields) => gitlab.createMergeRequest(c.projectId, fields),
    setPullRequestState: (c, number, state) => gitlab.setMergeRequestState(c.projectId, number, state),
    repoPath: (c) => c.repoPath,
    readIssue: (c, number) => gitlab.getIssue(c.projectId, number),
    async readPullRequest(c, number) {
      const [mr, diff] = await Promise.all([gitlab.getMergeRequest(c.projectId, number), gitlab.getMergeRequestDiff(c.projectId, number)]);
      return { ...mr, diff };
    },
    // kind is "issue" or "pull_request", as on the comment.
    comments: (c, number, _token, kind) => gitlab.listNotes(c.projectId, kind, number, { limit: 10 }),
    listPullCommits: (c, number) => gitlab.listMergeRequestCommits(c.projectId, number),
    readCommit: (c, sha) => gitlab.getCommit(c.projectId, sha),
  },
};

function platformOf(platform) {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`unknown platform ${platform}`);
  return adapter;
}

module.exports = { platformOf };
