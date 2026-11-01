// The agent lives in ./agent/; this file keeps the old import path working.
const { processTask } = require('./agent');
const { buildSystemPrompt, buildToolGuide, buildHistory } = require('./agent/prompt');
const { chatWithFallback } = require('./agent/keyFallback');
const { converse } = require('./agent/conversation');
const { formatCost } = require('./agent/cost');
const { isOrgMember, isRepoMember } = require('./agent/membership');

module.exports = { formatCost, processTask, buildSystemPrompt, buildToolGuide, buildHistory, chatWithFallback, converse, isOrgMember, isRepoMember };
