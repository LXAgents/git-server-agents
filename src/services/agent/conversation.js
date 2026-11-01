// One answer's model calls: the tool loop, the plain fallback for models without tools, and
// the deadline every call shares.
const config = require('../../config');
const llm = require('../ai/llmService');
const { TOOLS } = require('./repoTools');
const { DEFAULT_TOOL_ROUNDS } = require('./loopLimit');
const { addCost } = require('./cost');
const { logSafe } = require('../../utils/strings');
const log = require('../logService');

// OpenRouter answers 404 "No endpoints found that support tool use", and other providers a 400
// naming tools, when the chosen model cannot call tools.
function toolsUnsupported(err) {
  const status = err.response && err.response.status;
  if (status !== 400 && status !== 404) return false;
  const data = err.response.data;
  const text = typeof data === 'string' ? data : JSON.stringify(data || {});
  return /tool/i.test(text);
}

// The error for an answer that ran out of its TASK_TIMEOUT_MS.
function deadlineError(limitMs) {
  const err = new Error(`the answer took longer than ${limitMs}ms`);
  err.source = 'provider';
  err.code = 'ETIMEDOUT';
  err.deadline = limitMs;
  return err;
}

// One model call, cut short by the answer's deadline, and logged with its duration.
async function timedCall(request, apiKey, messages, tools) {
  const { deadline, limitMs, label = '', logMeta } = request;
  const remaining = deadline ? deadline - Date.now() : config.ai.modelTimeoutMs;
  if (remaining <= 0) throw deadlineError(limitMs);
  const started = Date.now();
  const { deadline: _d, limitMs: _l, label: _n, logMeta: _m, spend, ...body } = request;
  try {
    const reply = await llm.complete({ ...body, apiKey, messages, tools, timeout: Math.min(config.ai.modelTimeoutMs, remaining) });
    if (spend) addCost(spend, reply.cost);
    log.info('agent', `${label}${logSafe(request.model)} answered in ${Date.now() - started}ms${reply.tool_calls ? ' (tool calls)' : ''}`, logMeta);
    return reply;
  } catch (err) {
    log.warn('agent', `${label}${logSafe(request.model)} failed in ${Date.now() - started}ms: ${logSafe(err.message)}`, logMeta);
    if (deadline && Date.now() >= deadline && !err.response) throw deadlineError(limitMs);
    throw err;
  }
}

function contentOf(reply, model) {
  if (!reply.content) throw llm.emptyError(model);
  return reply.content;
}

const ANSWER_NOW = 'Answer now with what you have; do not call any more tools.';

// Up to `maxRounds` rounds of tool calls, then the model must answer. `repo.tools` are the
// tools this commenter may use; repo.run runs one and returns its text, errors included.
async function toolLoop(call, messages, repo, model, maxRounds) {
  const tools = repo.tools || TOOLS;
  for (let round = 0; round <= maxRounds; round += 1) {
    const last = round === maxRounds;
    if (last) messages.push({ role: 'user', content: ANSWER_NOW });
    const reply = await call(messages, tools);
    const toolCalls = reply.tool_calls || [];
    if (toolCalls.length === 0 || last) return contentOf(reply, model);
    // providerContent is the provider's own reply (Anthropic's content blocks), sent back
    // unchanged on the next round; other providers ignore it.
    const turn = { role: 'assistant', content: reply.content || '', tool_calls: toolCalls };
    if (reply.providerContent) turn.providerContent = reply.providerContent;
    messages.push(turn);
    for (const toolCall of toolCalls) {
      const fn = toolCall.function || {};
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: await repo.run(fn.name, fn.arguments) });
    }
  }
  throw new Error('unreachable');
}

// The model may call the repository tools, described to it by `toolGuide`; models without
// tool support get one plain request with the file list and named files inlined instead.
async function converse({ request, apiKey, system, toolGuide = '', history, question, repo, maxRounds = DEFAULT_TOOL_ROUNDS }) {
  const call = (messages, tools) => timedCall(request, apiKey, messages, tools);
  const ask = (systemText) => [{ role: 'system', content: systemText }, ...history, { role: 'user', content: question }];

  if (!repo) return contentOf(await call(ask(system)), request.model);
  try {
    return await toolLoop(call, ask(toolGuide ? `${system}\n\n${toolGuide}` : system), repo, request.model, maxRounds);
  } catch (err) {
    if (!toolsUnsupported(err)) throw err;
    log.warn('agent', `${logSafe(request.model)} does not support tools; adding repository context to the prompt instead`, request.logMeta);
    const context = await repo.inlineContext(question);
    return contentOf(await call(ask(`${system}\n\n${context}`)), request.model);
  }
}

module.exports = { converse, timedCall, toolsUnsupported, ANSWER_NOW };
