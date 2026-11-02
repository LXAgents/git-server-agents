const axios = require('axios');
const config = require('../../config');
const { streamCompletion } = require('./chatStream');
const { tokensOf } = require('./usage');

// An HTTP-shaped error for a failure OpenRouter reports inside a 200 response.
function bodyError(status, error) {
  const err = new Error(`OpenRouter error ${status}: ${(error && error.message) || 'unknown'}`);
  err.response = { status, data: { error }, headers: {} };
  err.source = 'openrouter';
  return err;
}

function emptyError(model) {
  const err = new Error(`empty response from model ${model}`);
  err.source = 'empty';
  return err;
}

function costOf(usage) {
  return usage && typeof usage.cost === 'number' ? usage.cost : null;
}

// The same call, streamed: each piece of text goes to onToken as it arrives.
async function completeStreaming({ url, headers, body, timeout, onToken, model }) {
  let reply;
  try {
    reply = await streamCompletion({ url, headers, body, timeout, onToken, bodyError });
  } catch (err) {
    err.source = err.source || 'openrouter';
    throw err;
  }
  if (!reply.content && !reply.tool_calls) throw emptyError(model);
  return { role: 'assistant', content: reply.content, tool_calls: reply.tool_calls, cost: costOf(reply.usage), tokens: tokensOf(reply.usage) };
}

// One chat completion. Returns the assistant message ({ content, tool_calls? }). Every failure
// is tagged source "openrouter" (or "empty"), so agentErrors can tell it from a platform error.
// With onToken the reply is streamed and every piece of text is passed to it as it arrives.
async function complete({ baseUrl, apiKey, model, messages, tools, timeout = config.ai.modelTimeoutMs, onToken }) {
  // usage.include makes OpenRouter report the call's cost (in credits, which are US dollars).
  const body = { model, messages, usage: { include: true } };
  if (tools && tools.length) body.tools = tools;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'git-server-agents' };
  if (onToken) return completeStreaming({ url, headers, body, timeout, onToken, model });
  let data;
  try {
    ({ data } = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'git-server-agents',
      },
      timeout,
    }));
  } catch (err) {
    err.source = 'openrouter';
    throw err;
  }
  // OpenRouter can answer 200 with an error, at the top level or on the choice, when the
  // upstream provider fails after the request was accepted.
  if (data && data.error) throw bodyError(Number(data.error.code) || 502, data.error);
  const choice = data && data.choices && data.choices[0];
  if (choice && choice.error) throw bodyError(Number(choice.error.code) || 502, choice.error);
  const message = choice && choice.message;
  if (!message || (!message.content && !(message.tool_calls && message.tool_calls.length))) throw emptyError(model);
  return { ...message, cost: costOf(data.usage), tokens: tokensOf(data.usage) };
}

// A single system + user exchange, returning the text.
async function chat({ baseUrl, apiKey, model, system, user }) {
  const message = await complete({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  if (!message.content) throw emptyError(model);
  return message.content;
}

module.exports = { complete, chat, emptyError };
