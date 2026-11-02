// One answer's model calls: the tool loop, the plain fallback for models without tools, and
// the deadline every call shares.
const config = require('../../config');
const llm = require('../ai/llmService');
const { TOOLS } = require('./repoTools');
const { DEFAULT_TOOL_ROUNDS } = require('./loopLimit');
const { addCost, addTokens } = require('./cost');
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

// Listeners (the chat) must never break an answer.
function safely(fn) {
  try {
    fn();
  } catch {
    // Ignored on purpose.
  }
}

// What the chat shows while a tool runs.
const TOOL_STATUS = {
  list_files: 'Listing the repository files...',
  read_file: (a) => `Reading ${a.path || 'a file'}...`,
  read_issue: (a) => `Reading issue ${a.number || ''}...`,
  read_pull_request: (a) => `Reading pull request ${a.number || ''}...`,
  list_commits: 'Listing commits...',
  read_commit: (a) => `Reading commit ${String(a.sha || '').slice(0, 7)}...`,
  create_issue: 'Opening an issue...',
  close_issue: 'Closing an issue...',
  reopen_issue: 'Reopening an issue...',
  create_pull_request: 'Opening a pull request...',
  close_pull_request: 'Closing a pull request...',
  reopen_pull_request: 'Reopening a pull request...',
  create_workspace: 'Creating GitHub Codespace...',
  exec_command: (a) => `Running: ${String(a.command || '').slice(0, 120)}`,
  commit_workspace: (a) => `Committing and pushing to ${a.branchName || 'a branch'}...`,
  delete_workspace: 'Deleting the workspace...',
  list_sessions: 'Listing the sessions...',
  create_session: (a) => `Creating session ${a.title ? `"${String(a.title).slice(0, 60)}"` : ''}...`,
  rename_session: (a) => `Renaming a session to "${String(a.title || '').slice(0, 60)}"...`,
  delete_session: 'Deleting a session...',
  update_memory: 'Updating MEMORY.md...',
  update_agents_md: 'Updating AGENTS.md...',
};

function toolStatus(name, rawArgs) {
  const entry = TOOL_STATUS[name];
  if (!entry) return `Running ${name}...`;
  if (typeof entry === 'string') return entry;
  let args = {};
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
  } catch {
    args = {};
  }
  return entry(args || {});
}

// One model call, cut short by the answer's deadline, and logged with its duration. With
// request.onToken the reply is streamed; request.onRound hears the start of every call.
async function timedCall(request, apiKey, messages, tools) {
  const { deadline, limitMs, label = '', logMeta } = request;
  const remaining = deadline ? deadline - Date.now() : config.ai.modelTimeoutMs;
  if (remaining <= 0) throw deadlineError(limitMs);
  const started = Date.now();
  const { deadline: _d, limitMs: _l, label: _n, logMeta: _m, spend, onToken, onTool: _t, onRound, ...body } = request;
  if (onRound) safely(() => onRound());
  try {
    const stream = onToken ? { onToken: (text) => safely(() => onToken(text)) } : {};
    const reply = await llm.complete({ ...body, ...stream, apiKey, messages, tools, timeout: Math.min(config.ai.modelTimeoutMs, remaining) });
    if (spend) {
      addCost(spend, reply.cost);
      addTokens(spend, reply.tokens);
    }
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
// `onTool({ tool, status })` hears each tool call before it runs, for the chat.
async function toolLoop(call, messages, repo, model, maxRounds, onTool) {
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
      if (onTool) safely(() => onTool({ tool: fn.name, status: toolStatus(fn.name, fn.arguments) }));
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
    return await toolLoop(call, ask(toolGuide ? `${system}\n\n${toolGuide}` : system), repo, request.model, maxRounds, request.onTool);
  } catch (err) {
    if (!toolsUnsupported(err)) throw err;
    log.warn('agent', `${logSafe(request.model)} does not support tools; adding repository context to the prompt instead`, request.logMeta);
    const context = await repo.inlineContext(question);
    return contentOf(await call(ask(`${system}\n\n${context}`)), request.model);
  }
}

module.exports = { converse, timedCall, toolsUnsupported, toolStatus, ANSWER_NOW };
