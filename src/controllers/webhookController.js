const config = require('../config');
const { verifyGithubSignature, verifyGitlabToken } = require('../services/platforms/signatureService');
const { githubIdentity, gitlabIdentity } = require('../services/platforms/identityService');
const whitelist = require('../services/whitelistService');
const tasks = require('../services/taskService');
const { toComment } = require('../services/eventService');
const { parseComment } = require('../services/commentParser');
const { logSafe } = require('../utils/strings');
const log = require('../services/logService');

// Without a secret anyone could forge an event, so production (PROD=prod) refuses to run
// unsigned. Development allows it so the endpoints can be exercised with curl. Returns null
// when the request may go on, or why it may not. The reason is logged and sent back: GitHub
// shows it under the App's Recent deliveries, and it names a setting, not a secret.
function refusal({ authentic, secret, sent, envName, header }) {
  if (!secret) {
    return config.isProd ? `${envName} is not set on the server, and PROD=prod refuses unsigned webhooks` : null;
  }
  if (authentic) return null;
  if (!sent) return `no ${header} header: set the same secret in the App's webhook settings`;
  return `${header} does not match ${envName}: set the same secret on the server and in the App's webhook settings`;
}

function refuse(res, platform, reason) {
  log.warn('webhook', `401 ${reason}`, { platform });
  return res.status(401).json({ error: reason });
}

// A new comment whose line 1 is a trigger (@lxagents or @vendor/model). Nothing else is queued.
function isTrigger(platform, event, payload) {
  const comment = toComment(platform, event, payload);
  if (!comment) return false;
  const parsed = parseComment(comment.commentBody);
  return Boolean(parsed.auto || parsed.model);
}

async function accept(res, platform, event, identity, payload) {
  const what = `${logSafe(event)}${payload.action ? `.${logSafe(payload.action)}` : ''} from ${logSafe(identity.triggerUser || identity.triggerUserId)} in ${logSafe(identity.targetOrg)}`;
  if (!isTrigger(platform, event, payload)) {
    log.info('webhook', `${what}: ignored, not a trigger comment`, { platform });
    return res.status(200).json({ status: 'ignored' });
  }
  const result = await whitelist.verify(platform, identity);
  if (!result.allowed) {
    log.warn('webhook', `${what}: 403 ${logSafe(result.reason)}`, { platform });
    // The reason stays in the server log; telling the caller which check failed helps probing.
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const task = await tasks.enqueue(platform, event, payload);
  log.info('webhook', `${what}: queued task ${task.id}`, { platform, taskId: task.id });
  return res.status(200).json({ status: 'queued', taskId: task.id });
}

async function github(req, res, next) {
  try {
    const secret = config.github.webhookSecret;
    const signature = req.get('x-hub-signature-256');
    const reason = refusal({
      authentic: verifyGithubSignature(req.rawBody, signature, secret),
      secret,
      sent: Boolean(signature),
      envName: 'GITHUB_WEBHOOK_SECRET',
      header: 'X-Hub-Signature-256',
    });
    if (reason) return refuse(res, 'github', reason);
    const event = req.get('x-github-event') || 'unknown';
    if (event === 'ping') return res.status(200).json({ status: 'pong' });
    return await accept(res, 'github', event, githubIdentity(req.body), req.body);
  } catch (err) {
    return next(err);
  }
}

async function gitlab(req, res, next) {
  try {
    const secret = config.gitlab.webhookSecret;
    const token = req.get('x-gitlab-token');
    const reason = refusal({
      authentic: verifyGitlabToken(token, secret),
      secret,
      sent: Boolean(token),
      envName: 'GITLAB_WEBHOOK_SECRET',
      header: 'X-Gitlab-Token',
    });
    if (reason) return refuse(res, 'gitlab', reason);
    const event = req.body.object_kind || req.get('x-gitlab-event') || 'unknown';
    return await accept(res, 'gitlab', event, gitlabIdentity(req.body), req.body);
  } catch (err) {
    return next(err);
  }
}

module.exports = { github, gitlab };
