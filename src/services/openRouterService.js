const axios = require('axios');

async function chat({ baseUrl, apiKey, model, system, user }) {
  const { data } = await axios.post(
    `${baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'git-server-agents',
      },
      timeout: 120_000,
    }
  );
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error(`empty response from model ${model}`);
  return content;
}

module.exports = { chat };
