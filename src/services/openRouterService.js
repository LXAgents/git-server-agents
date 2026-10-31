const axios = require('axios');

// One chat completion. Returns the assistant message ({ content, tool_calls? }).
async function complete({ baseUrl, apiKey, model, messages, tools }) {
  const body = { model, messages };
  if (tools && tools.length) body.tools = tools;
  const { data } = await axios.post(`${baseUrl.replace(/\/$/, '')}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'git-server-agents',
    },
    timeout: 120_000,
  });
  const message = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!message || (!message.content && !(message.tool_calls && message.tool_calls.length))) {
    throw new Error(`empty response from model ${model}`);
  }
  return message;
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
  if (!message.content) throw new Error(`empty response from model ${model}`);
  return message.content;
}

module.exports = { complete, chat };
