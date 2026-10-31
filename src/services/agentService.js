const config = require('../config');
const { githubIdentity, gitlabIdentity } = require('./identityService');
const whitelist = require('./whitelistService');
const { toComment, REPLY_MARKER } = require('./eventService');
const { parseComment } = require('./commentParser');
const github = require('./githubService');
const gitlab = require('./gitlabService');
const keys = require('./keyService');
const openRouter = require('./openRouterService');

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[diff truncated at ${max} characters]`;
}

function buildSystemPrompt(comment, diff) {
  const subject = comment.kind === 'pull_request' ? 'pull request' : 'issue';
  const lines = [
    `You are a code assistant replying to a comment on a ${comment.platform} ${subject}.`,
    'Answer in Markdown. Be specific and refer to files and lines from the context when relevant.',
    '',
    `Title: ${comment.title}`,
  ];
  if (comment.description) lines.push('', 'Description:', comment.description);
  if (diff) lines.push('', 'Diff:', '```diff', truncate(diff, config.ai.maxDiffChars), '```');
  return lines.join('\n');
}

// Processes one AgentTask. Resolves to "success" or "skipped"; throws to fail the task.
async function processTask(task) {
  const payload = JSON.parse(task.payload);
  const comment = toComment(task.platform, task.event, payload);
  if (!comment) return 'skipped';

  const { model, prompt } = parseComment(comment.commentBody, config.ai.defaultModel);
  if (!prompt) return 'skipped';

  // Check the whitelist again: access may have been revoked while the task was queued.
  const identity = task.platform === 'github' ? githubIdentity(payload) : gitlabIdentity(payload);
  const access = await whitelist.verify(task.platform, identity);
  if (!access.allowed) throw new Error(`no longer whitelisted: ${access.reason}`);

  let diff = '';
  let token;
  if (task.platform === 'github') {
    const installationId = identity.installationId || access.installation.installationId;
    if (!installationId) throw new Error('payload has no GitHub App installation id');
    token = await github.installationToken(installationId);
    if (comment.pullUrl) diff = await github.getPullDiff(comment.pullUrl, token);
  } else if (comment.kind === 'pull_request') {
    diff = await gitlab.getMergeRequestDiff(comment.projectId, comment.number);
  }

  // The trigger user's own key wins; the org owner's key is the fallback.
  const owner = { type: access.installation.accountType, id: access.installation.accountId };
  const accounts = [{ type: task.platform, id: identity.triggerUserId }];
  if (owner.type !== accounts[0].type || owner.id !== accounts[0].id) accounts.push(owner);
  const { provider, apiKey } = await keys.getProviderKey(config.ai.providerName, accounts);

  const answer = await openRouter.chat({
    baseUrl: provider.url || 'https://openrouter.ai/api/v1',
    apiKey,
    model,
    system: buildSystemPrompt(comment, diff),
    user: prompt,
  });

  const reply = `${answer}\n\n<sub>Model: \`${model}\`</sub>\n${REPLY_MARKER}`;
  if (task.platform === 'github') {
    await github.postComment(comment.repo, comment.number, reply, token);
  } else {
    await gitlab.postNote(comment.projectId, comment.kind, comment.number, reply);
  }
  return 'success';
}

module.exports = { processTask, buildSystemPrompt };
