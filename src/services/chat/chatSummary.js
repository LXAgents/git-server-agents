// What the Chat page's details pane shows for a room: its name and platform, the model and
// provider the agent would answer with, how many keys it could use (never the keys), and the
// tokens and cost of the answers stored in the room. Readable by everyone who may read the room,
// which the repository and org model and key pages are not.
const prisma = require('../../db');
const models = require('../ai/modelService');
const keys = require('../keyService');
const { findProvider } = require('../ai/providers');
const { platformOf } = require('../agent/platform');
const { findWorkspaceKeys, findWorkspaceProvider, DEFAULT_WORKSPACE_PROVIDER } = require('../workspaceKeyService');
const { roomScope } = require('./chatAgent');
const { parseData } = require('./chatStore');

// The newest answers counted for the totals, so a busy room stays one quick query.
const STATS_LIMIT = 5000;

async function modelAndKeys(scope) {
  const { account, installation, orgMember, repository } = scope;
  const chosen = await models.resolveModel({ repository, installation, account }, 'text');
  const info = findProvider(chosen.provider);
  const counts = info ? await keys.countProviderKeys(info.slug, account, orgMember ? installation : null, repository) : { repo: 0, org: 0, user: 0 };
  return {
    model: { provider: info ? info.slug : chosen.provider, providerName: info ? info.name : chosen.provider, model: chosen.model, source: chosen.source },
    ai: { ...counts, total: counts.repo + counts.org + counts.user },
  };
}

async function workspaceKeys(platform, scope) {
  if (!platformOf(platform).workspaces) return null;
  const found = await findWorkspaceKeys(DEFAULT_WORKSPACE_PROVIDER, scope.account, scope.orgMember ? scope.installation : null, scope.repository);
  const counts = { repo: 0, org: 0, user: 0 };
  for (const key of found) counts[key.owner] += 1;
  return { provider: DEFAULT_WORKSPACE_PROVIDER, providerName: findWorkspaceProvider(DEFAULT_WORKSPACE_PROVIDER).name, ...counts, total: found.length };
}

// Adds up the usage stored with the agent's answers and reports. Answers stored before 1.19.0,
// and error replies, have none and are counted in answersWithoutUsage.
function addUp(rows) {
  const stats = { answers: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costComplete: true, tokensComplete: true, answersWithoutUsage: 0 };
  for (const row of rows) {
    stats.answers += 1;
    const data = parseData(row.data);
    const usage = data && data.usage;
    if (!usage) {
      stats.answersWithoutUsage += 1;
      continue;
    }
    stats.inputTokens += Number(usage.inputTokens) || 0;
    stats.outputTokens += Number(usage.outputTokens) || 0;
    if (typeof usage.costUsd === 'number') stats.costUsd += usage.costUsd;
    if (!usage.costComplete) stats.costComplete = false;
    if (usage.tokensComplete === false) stats.tokensComplete = false;
  }
  stats.costUsd = Math.round(stats.costUsd * 1e6) / 1e6;
  return stats;
}

async function roomStats(roomKey) {
  const rows = await prisma.chatMessage.findMany({
    where: { role: 'assistant', type: { in: ['message', 'report'] }, session: { room: roomKey } },
    orderBy: { createdAt: 'desc' },
    take: STATS_LIMIT,
    select: { data: true },
  });
  return { ...addUp(rows), capped: rows.length === STATS_LIMIT };
}

// `room` comes from rooms.authorizeRoom, so the caller may read it.
async function summary(room, user) {
  const scope = await roomScope(room, user);
  const [{ model, ai }, workspace, stats] = await Promise.all([modelAndKeys(scope), workspaceKeys(user.platform, scope), roomStats(room.key)]);
  return {
    room: { room: room.room, kind: room.kind, name: room.name || user.login, platform: user.platform },
    model,
    keys: { ai, workspace },
    stats,
  };
}

module.exports = { summary, addUp, STATS_LIMIT };
