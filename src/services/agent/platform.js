// Everything the agent asks GitHub or GitLab, behind one shape per platform, so the agent's
// flow never branches on the platform. `c` is the comment from eventService.toComment.
const github = require('../githubService');
const gitlab = require('../gitlabService');
const { githubIdentity, gitlabIdentity } = require('../identityService');

// Who owns the GitHub repository the webhook came from: { id, type }.
function githubAccount(payload) {
  return (payload.repository && payload.repository.owner) || (payload.installation && payload.installation.account) || {};
}

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
    // The commit files are read at: the PR head, or the default branch for an issue.
    async resolveRef(c, token) {
      if (c.headSha) return c.headSha;
      if (!c.pullUrl) return c.defaultBranch;
      const pull = await github.getPull(c.pullUrl, token);
      return (pull.head && pull.head.sha) || c.defaultBranch;
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
    resolveRef: async (c) => c.headSha || c.defaultBranch,
    async isOrgMember(identity) {
      if (await gitlab.groupExists(identity.targetOrg)) return gitlab.isGroupMember(identity.targetOrg, identity.triggerUserId);
      // A personal namespace: only its owner counts.
      return String(identity.targetOrg).toLowerCase() === String(identity.triggerUser || '').toLowerCase();
    },
    isRepoMember: (identity, c) => gitlab.isProjectMember(c.projectId, identity.triggerUserId),
    getRepoTree: (source) => gitlab.getRepoTree(source.projectId, source.ref),
    getFileContent: (source, path) => gitlab.getFileContent(source.projectId, path, source.ref),
  },
};

function platformOf(platform) {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`unknown platform ${platform}`);
  return adapter;
}

module.exports = { platformOf };
