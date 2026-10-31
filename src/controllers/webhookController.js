const config = require('../config');
const { verifyGithubSignature, verifyGitlabToken } = require('../services/signatureService');
const { githubIdentity, gitlabIdentity } = require('../services/identityService');
const whitelist = require('../services/whitelistService');
const tasks = require('../services/taskService');
const { toComment } = require('../services/eventService');
const { parseComment } = require('../services/commentParser');
const { logSafe } = require('../utils/strings');

// Without a secret anyone could forge a whitelisted sender, so production refuses to run
// unsigned. Development allows it so the endpoints can be exercised with curl.
function checkAuthenticity(authentic, secret) {
  if (secret) return authentic;
  if (config.isProd) return false;
  return true;
}

// A trigger comment from someone who isn't whitelisted, in an org that is imported.
function isTriggerInImportedOrg(platform, event, payload, result) {
  if (!result.installation) return false;
  const comment = toComment(platform, event, payload);
  if (!comment) return false;
  const parsed = parseComment(comment.commentBody);
  return Boolean(parsed.auto || parsed.model);
}

async function accept(res, platform, event, identity, payload) {
  const result = await whitelist.verify(platform, identity);
  if (!result.allowed) {
    console.warn(`[webhook:${platform}] 403 ${logSafe(event)}: ${logSafe(result.reason)}`);
    // The agent replies NOT_WHITELISTED there, so the commenter knows why nothing answers.
    // Orgs nobody imported get nothing: the apps are public.
    if (isTriggerInImportedOrg(platform, event, payload, result)) await tasks.enqueue(platform, event, payload);
    // The reason stays in the server log; telling the caller which check failed helps probing.
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const task = await tasks.enqueue(platform, event, payload);
  return res.status(200).json({ status: 'queued', taskId: task.id });
}

async function github(req, res, next) {
  try {
    const secret = config.github.webhookSecret;
    const signature = req.get('x-hub-signature-256');
    if (!checkAuthenticity(verifyGithubSignature(req.rawBody, signature, secret), secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
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
    if (!checkAuthenticity(verifyGitlabToken(req.get('x-gitlab-token'), secret), secret)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const event = req.body.object_kind || req.get('x-gitlab-event') || 'unknown';
    return await accept(res, 'gitlab', event, gitlabIdentity(req.body), req.body);
  } catch (err) {
    return next(err);
  }
}

module.exports = { github, gitlab };
