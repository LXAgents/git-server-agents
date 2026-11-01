// The agent's flow for one queued comment: check the trigger and the org, gather the thread,
// pick the provider, model and keys, ask the model, and post the answer (or why there is none).
// Each step's details live in the files next to this one.
const config = require('../../config');
const whitelist = require('../whitelistService');
const { toComment, REPLY_MARKER, ERROR_MARKER } = require('../eventService');
const { parseComment } = require('../commentParser');
const models = require('../ai/modelService');
const repoStore = require('../repoStore');
const keys = require('../keyService');
const { findProvider } = require('../ai/providers');
const { AgentError, formatReply } = require('../agentErrors');
const { createRepoTools } = require('./repoTools');
const { platformOf } = require('./platform');
const { isOrgMember, isRepoMember, canManage } = require('./membership');
const { createThreadActions } = require('./threadActions');
const { createThreadReader } = require('./threadReader');
const { findReferences } = require('./references');
const { buildSystemPrompt, buildToolGuide, buildHistory, replyFooter } = require('./prompt');
const { parseLoopLimit } = require('./loopLimit');
const { chatWithFallback } = require('./keyFallback');
const { converse } = require('./conversation');
const { newSpend, formatCost } = require('./cost');
const { logSafe } = require('../../utils/strings');
const log = require('../logService');

function taskMeta(task) {
  return { platform: task.platform, taskId: task.id };
}

// The GitHub App installation token, or undefined on GitLab (which uses the bot token).
async function platformToken(api, installationId) {
  if (!api.needsToken) return undefined;
  if (!installationId) throw new Error('payload has no GitHub App installation id');
  return api.token(installationId);
}

// Tells the commenter why there is no answer: a code, the status and whether to retry. A
// failure to post is only logged, so the task still records the original error.
async function replyWithError(task, comment, ctx, err) {
  const api = platformOf(task.platform);
  try {
    let token = ctx.token;
    if (api.needsToken && !token) {
      if (!ctx.installationId) return;
      token = await api.token(ctx.installationId);
    }
    const body = `${formatReply(err, { model: ctx.model, taskId: task.id })}\n${REPLY_MARKER}\n${ERROR_MARKER}`;
    await api.postReply(comment, body, token);
  } catch (postErr) {
    log.error('agent', `task ${task.id}: could not post the error reply: ${logSafe(postErr.message)}`, taskMeta(task));
  }
}

// 👀 on the comment, so the commenter sees at once that the agent is on it. Best effort.
async function acknowledge(task, api, comment, token) {
  try {
    await api.acknowledge(comment, token);
  } catch (err) {
    log.warn('agent', `task ${task.id}: could not add the eyes reaction: ${logSafe(err.message)}`, taskMeta(task));
  }
}

// The provider, model and the keys the commenter may spend on it. Strict BYOK: the server has
// no key of its own, so no allowed key means no model call.
async function chooseModelAndKeys(task, payload, comment, parsed, identity, access, token) {
  const account = { type: task.platform, id: identity.triggerUserId };
  // The agent answers text today; other modalities get their own trigger later.
  const modality = 'text';
  const [repository, member] = await Promise.all([
    repoStore.findForEvent(task.platform, payload, access.installation),
    isOrgMember(task.platform, identity, payload, token),
  ]);
  const [chosen, repoMember] = await Promise.all([
    // "@vendor/model" names an OpenRouter model; "@lxagents" uses the stored provider and model.
    parsed.model ? { provider: 'openrouter', model: parsed.model } : models.resolveModel({ repository, installation: access.installation, account }, modality),
    repository ? isRepoMember(task.platform, identity, comment, member, token) : false,
  ]);
  const providerInfo = findProvider(chosen.provider);
  if (!providerInfo) throw new AgentError('BAD_REQUEST', `The stored provider ${chosen.provider} is not supported. Pick another one on the dashboard.`);

  const { provider, keys: candidates } = await keys.getProviderKeys(
    providerInfo.slug,
    account,
    member ? access.installation : null,
    repoMember ? repository : null
  );
  if (candidates.length === 0) {
    const orgNote = member ? `, the repository or ${identity.targetOrg}` : ` (repository and org keys need membership of ${identity.targetOrg})`;
    const platformName = platformOf(task.platform).name;
    throw new AgentError(
      'NO_API_KEY',
      `No active ${providerInfo.name} key for you${orgNote}. Log in to the dashboard with ${platformName} and add your own ${providerInfo.name} key.`
    );
  }
  return { model: chosen.model, providerInfo, baseUrl: provider.url || providerInfo.url(), candidates };
}

// Everything after the trigger check. `ctx` collects the token and model as they become known,
// for the error reply.
async function answerComment(task, payload, comment, parsed, identity, access, ctx) {
  if (!parsed.prompt) throw new AgentError('NO_QUESTION', 'The comment starts with a trigger but asks nothing.');

  const api = platformOf(task.platform);
  const token = await platformToken(api, ctx.installationId);
  ctx.token = token;
  await acknowledge(task, api, comment, token);

  const [diff, thread, choice, manage] = await Promise.all([
    api.diff(comment, token),
    api.history(comment, token),
    chooseModelAndKeys(task, payload, comment, parsed, identity, access, token),
    canManage(task.platform, identity, comment, token),
  ]);
  const { model, providerInfo, baseUrl, candidates } = choice;
  ctx.model = model;

  const ref = await api.resolveRef(comment, token);
  const asker = comment.author || identity.triggerUser || 'unknown';
  const actions = manage ? createThreadActions({ platform: task.platform, thread: comment, token, asker }) : null;
  // Other threads are read only when the commenter's own message mentions them.
  const refs = findReferences(parsed.prompt, { platform: task.platform, repoPath: api.repoPath(comment) });
  const reader = createThreadReader({ platform: task.platform, thread: comment, token, refs });
  const repo = ref ? createRepoTools({ platform: task.platform, repo: comment.repo, projectId: comment.projectId, ref, token }, { actions, reader }) : null;
  const request = {
    provider: providerInfo.slug,
    baseUrl,
    model,
    deadline: ctx.started + config.ai.taskTimeoutMs,
    limitMs: config.ai.taskTimeoutMs,
    label: `task ${task.id}: `,
    logMeta: taskMeta(task),
    spend: newSpend(),
  };
  const { rounds } = parseLoopLimit(parsed.prompt);
  log.info('agent', `task ${task.id}: asking ${providerInfo.name} ${logSafe(model)} with ${candidates.length} key(s), up to ${rounds} tool round(s)${actions ? ', with the manage tools' : ''}`, request.logMeta);
  const answer = await chatWithFallback(
    candidates,
    (key) =>
      converse({
        request,
        apiKey: key.apiKey,
        system: buildSystemPrompt(comment, diff),
        toolGuide: buildToolGuide({ rounds, manage: Boolean(actions), thread: comment, readTools: Object.keys(reader) }),
        maxRounds: rounds,
        history: buildHistory(thread, comment.commentId),
        question: `@${comment.author || identity.triggerUser || 'user'}: ${parsed.prompt}`,
        repo,
      }),
    request.logMeta
  );

  const footer = replyFooter({
    model,
    providerName: providerInfo.name,
    cost: formatCost(request.spend),
    loop: rounds,
    asker,
  });
  await api.postReply(comment, `${answer}\n\n${footer}\n${REPLY_MARKER}`, token);
  return 'success';
}

// Processes one AgentTask. Resolves to "success" or "skipped"; throws to fail the task. Once a
// comment is a trigger in an imported org, every failure is answered with an error reply.
async function processTask(task) {
  const payload = JSON.parse(task.payload);
  const comment = toComment(task.platform, task.event, payload);
  if (!comment) return 'skipped';

  // The agent only answers when line 1 starts with "@lxagents" or names a model ("@openrouter/free").
  const parsed = parseComment(comment.commentBody);
  if (!(parsed.auto || parsed.model)) {
    log.info('agent', `task ${task.id} skipped: line 1 must start with @lxagents or @vendor/model`, taskMeta(task));
    return 'skipped';
  }

  // Check the org again: it may have been removed while the task was queued. In an org nobody
  // imported the app must not act at all, not even to say why.
  const api = platformOf(task.platform);
  const identity = api.identity(payload);
  const access = await whitelist.verify(task.platform, identity);
  if (!access.allowed) throw new Error(`not allowed: ${access.reason}`);

  const ctx = {
    started: Date.now(),
    model: parsed.model,
    token: null,
    installationId: api.needsToken ? identity.installationId || access.installation.installationId : null,
  };
  try {
    return await answerComment(task, payload, comment, parsed, identity, access, ctx);
  } catch (err) {
    await replyWithError(task, comment, ctx, err);
    throw err;
  }
}

module.exports = { processTask, answerComment };
