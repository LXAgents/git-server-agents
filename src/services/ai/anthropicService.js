// Anthropic's Messages API through the official SDK. The agent speaks the Chat Completions
// shape (system/user/assistant/tool messages, OpenAI-style tools), so requests and replies are
// translated here, and the reply comes back as { content, tool_calls?, cost, tokens } like the others.
const Anthropic = require('@anthropic-ai/sdk');
const { tokensOf } = require('./usage');
const config = require('../../config');

const Client = Anthropic.default || Anthropic;

function client(baseUrl, apiKey, timeout) {
  // Retries are the agent's job (it falls through to the next key), so the SDK makes one try.
  return new Client({ apiKey, baseURL: baseUrl, timeout, maxRetries: 0 });
}

// SDK errors carry status, error body and headers; agentErrors reads them as err.response.
function tag(err) {
  if (err && typeof err.status === 'number') {
    const headers = err.headers && typeof err.headers.get === 'function' ? Object.fromEntries(err.headers) : err.headers || {};
    err.response = { status: err.status, data: err.error, headers };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) err.code = 'ETIMEDOUT';
  err.source = 'provider';
  err.providerName = 'Anthropic';
  return err;
}

function emptyError(model) {
  const err = new Error(`empty response from model ${model}`);
  err.source = 'empty';
  return err;
}

function parseArguments(text) {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

// One assistant message as content blocks. A reply this service returned carries its original
// blocks (thinking included), which go back unchanged.
function assistantContent(m) {
  if (Array.isArray(m.providerContent)) return m.providerContent;
  const blocks = [];
  if (m.content) blocks.push({ type: 'text', text: String(m.content) });
  for (const call of m.tool_calls || []) {
    const fn = call.function || {};
    blocks.push({ type: 'tool_use', id: call.id, name: fn.name, input: parseArguments(fn.arguments) });
  }
  return blocks.length ? blocks : [{ type: 'text', text: '(no text)' }];
}

// Chat Completions messages -> { system, messages }. System messages join the top-level
// system prompt; tool results become tool_result blocks in a user turn; turns of one role in a
// row are merged; and the conversation always starts with a user turn.
function toAnthropic(messages) {
  const system = [];
  const out = [];
  const push = (role, blocks) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const m of messages) {
    if (m.role === 'system') system.push(String(m.content || ''));
    else if (m.role === 'assistant') push('assistant', assistantContent(m));
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '') }]);
    else push('user', [{ type: 'text', text: String(m.content || '') }]);
  }
  if (!out.length || out[0].role !== 'user') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation so far)' }] });
  return { system: system.join('\n\n'), messages: out };
}

function toAnthropicTools(tools) {
  return (tools || []).map((t) => {
    const fn = t.function || t;
    return { name: fn.name, description: fn.description || '', input_schema: fn.parameters || { type: 'object', properties: {} } };
  });
}

// Anthropic reply -> { content, tool_calls?, cost, tokens, providerContent }.
function fromAnthropic(reply) {
  const blocks = Array.isArray(reply && reply.content) ? reply.content : [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
  return { content: text, tool_calls: toolCalls.length ? toolCalls : undefined, cost: null, tokens: tokensOf(reply && reply.usage), providerContent: blocks };
}

// Sends the request; with onToken it is streamed and every text delta is passed on as it arrives.
async function send(api, body, onToken) {
  if (!onToken) return api.messages.create(body);
  const stream = api.messages.stream(body);
  stream.on('text', (delta) => onToken(delta));
  return stream.finalMessage();
}

async function complete({ baseUrl, apiKey, model, messages, tools, timeout = config.ai.modelTimeoutMs, onToken }) {
  const { system, messages: turns } = toAnthropic(messages);
  const body = { model, max_tokens: config.ai.maxOutputTokens, messages: turns };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = toAnthropicTools(tools);
  let reply;
  try {
    reply = await send(client(baseUrl, apiKey, timeout), body, onToken);
  } catch (err) {
    throw tag(err);
  }
  if (reply.stop_reason === 'refusal') {
    const err = new Error('the model declined to answer');
    err.response = { status: 400, data: { error: { message: 'The model declined to answer this request (refusal).' } }, headers: {} };
    throw tag(err);
  }
  const message = fromAnthropic(reply);
  if (!message.content && !message.tool_calls) throw emptyError(model);
  return message;
}

// Every model the key can use, from GET /v1/models (all pages).
async function listModels({ baseUrl, apiKey, timeout = 15_000 }) {
  const models = [];
  try {
    for await (const m of client(baseUrl, apiKey, timeout).models.list({ limit: 1000 })) {
      models.push({ id: m.id, name: m.display_name || m.id, contextLength: Number(m.max_input_tokens) || null });
    }
  } catch (err) {
    throw tag(err);
  }
  return models;
}

module.exports = { complete, listModels, toAnthropic, fromAnthropic, toAnthropicTools };
