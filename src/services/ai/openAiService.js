// OpenAI's Chat Completions API, and the providers that speak the same protocol at their own
// base URL: DeepSeek (https://api.deepseek.com) and z.ai GLM (https://api.z.ai/api/paas/v4).
// Returns the assistant message ({ content, tool_calls?, cost }) like openRouterService.
const axios = require('axios');
const config = require('../../config');
const { streamCompletion } = require('./chatStream');

// Every failure is tagged source "provider" with the provider's name, so agentErrors can tell
// it from a platform error and name the provider in the reply.
function tag(err, providerName) {
  err.source = 'provider';
  err.providerName = providerName;
  return err;
}

function emptyError(model) {
  const err = new Error(`empty response from model ${model}`);
  err.source = 'empty';
  return err;
}

// Only the fields the Chat Completions API knows: other providers' extras (such as Anthropic's
// raw content blocks) are dropped.
function toWire(m) {
  const out = { role: m.role, content: m.content === undefined ? '' : m.content };
  if (m.tool_calls) out.tool_calls = m.tool_calls;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  return out;
}

// With onToken the reply is streamed and every piece of text is passed to it as it arrives.
async function complete({ baseUrl, apiKey, model, messages, tools, timeout = config.ai.modelTimeoutMs, providerName = 'OpenAI', onToken }) {
  const body = { model, messages: messages.map(toWire) };
  if (tools && tools.length) body.tools = tools;
  if (onToken) {
    let reply;
    try {
      reply = await streamCompletion({
        url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        timeout,
        onToken,
        bodyError: (status, error) => {
          const err = new Error(`${providerName} error: ${error.message || 'unknown'}`);
          err.response = { status, data: { error }, headers: {} };
          return err;
        },
      });
    } catch (err) {
      throw tag(err, providerName);
    }
    if (!reply.content && !reply.tool_calls) throw emptyError(model);
    return { content: reply.content, tool_calls: reply.tool_calls, cost: null };
  }
  let data;
  try {
    ({ data } = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout,
    }));
  } catch (err) {
    throw tag(err, providerName);
  }
  if (data && data.error) {
    const err = new Error(`${providerName} error: ${data.error.message || 'unknown'}`);
    err.response = { status: Number(data.error.code) || 502, data: { error: data.error }, headers: {} };
    throw tag(err, providerName);
  }
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message || (!message.content && !(message.tool_calls && message.tool_calls.length))) throw emptyError(model);
  return { content: message.content || '', tool_calls: message.tool_calls, cost: null };
}

// Ids that are not chat models: embeddings, speech, images, moderation and the like.
const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|image|transcribe|sora|realtime|audio|babbage|davinci/i;

// The provider's GET /models, as the dashboard's picker shows models.
async function listModels({ baseUrl, apiKey, providerName = 'OpenAI', timeout = 15_000 }) {
  try {
    const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout,
    });
    const rows = Array.isArray(data && data.data) ? data.data : [];
    return rows
      .filter((m) => m && typeof m.id === 'string' && !NOT_CHAT.test(m.id))
      .map((m) => ({ id: m.id, name: m.name || m.id, created: Number(m.created) || null }));
  } catch (err) {
    throw tag(err, providerName);
  }
}

module.exports = { complete, listModels, emptyError };
