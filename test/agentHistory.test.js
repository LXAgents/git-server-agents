const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHistory, buildSystemPrompt, buildToolGuide } = require('../src/services/agentService');
const { replyFooter } = require('../src/services/agent/prompt');
const { REPLY_MARKER } = require('../src/services/eventService');

const reply = (text, model = 'openrouter/free') => `${text}\n\n<sub>Model: \`${model}\`</sub>\n${REPLY_MARKER}`;

test('maps our replies to assistant and everyone else to user with their login', () => {
  const history = buildHistory(
    [
      { id: 1, author: 'alice', body: '@openrouter/free\nWhat does app.js do?' },
      { id: 2, author: 'agent[bot]', body: reply('It starts the server.') },
      { id: 3, author: 'bob', body: 'Looks good to me' },
      { id: 4, author: 'alice', body: '@openrouter/free\nAnd the worker?' },
    ],
    4
  );
  assert.deepEqual(history, [
    { role: 'user', content: '@alice: What does app.js do?' },
    { role: 'assistant', content: 'It starts the server.' },
    { role: 'user', content: '@bob: Looks good to me' },
  ]);
});

test('drops the oldest messages once the history is too long, and skips empty ones', () => {
  const comments = [
    { id: 1, author: 'a', body: 'x'.repeat(50) },
    { id: 2, author: 'b', body: '   ' },
    { id: 3, author: 'c', body: 'y'.repeat(50) },
  ];
  const history = buildHistory(comments, undefined, 70);
  assert.deepEqual(history.map((m) => m.content), [`@c: ${'y'.repeat(50)}`]);
});

test('the system prompt handles an issue with no diff, and the tools are only in the tool guide', () => {
  const prompt = buildSystemPrompt({ platform: 'gitlab', kind: 'issue', title: 'Bug', description: '' }, '');
  assert.match(prompt, /gitlab issue/);
  assert.doesNotMatch(prompt, /list_files/);
  assert.doesNotMatch(prompt, /Diff:/);
  const guide = buildToolGuide({ rounds: 5 });
  assert.match(guide, /list_files/);
  assert.match(guide, /you have 5 rounds for this answer/);
  assert.match(buildToolGuide({ rounds: 1 }), /you have 1 round for/);
  const mr = buildSystemPrompt({ platform: 'gitlab', kind: 'pull_request', title: 'MR' }, 'diff --git a b');
  assert.match(mr, /merge request/);
  assert.match(mr, /```diff/);
  assert.doesNotMatch(mr, /list_files/);
});

test('strips the model footer, and stays fast on bodies built to slow a regex down', () => {
  assert.deepEqual(buildHistory([{ id: 1, author: 'bot', body: reply('Answer\n\n<sub>keep</sub>') }]), [
    { role: 'assistant', content: 'Answer\n\n<sub>keep</sub>' },
  ]);
  const hostile = `${REPLY_MARKER}${'\n'.repeat(100_000)}<sub>Model: \`x`;
  const started = Date.now();
  const [message] = buildHistory([{ id: 1, author: 'bot', body: hostile }]);
  assert.equal(message.content, '<sub>Model: `x');
  assert.ok(Date.now() - started < 200);
});

test('the Model, Cost, Loop and User footer is left out of the history', () => {
  const body = `Answer.\n\n<sub>Model: \`m/x\`</sub>\n<sub>Cost: \`0.0001 USD\`</sub>\n<sub>Loop: \`3\`</sub>\n<sub>User: \`@alice\`</sub>\n${REPLY_MARKER}`;
  const [message] = buildHistory([{ id: 1, author: 'bot', body }]);
  assert.deepEqual(message, { role: 'assistant', content: 'Answer.' });
  const full = `Answer.\n\n${replyFooter({ model: 'm/x', providerName: 'OpenRouter', cost: '0 USD', loop: 5, asker: 'alice' })}\n${REPLY_MARKER}`;
  assert.match(full, /<sub>Cost: `0 USD`<\/sub>\n<sub>Loop: `5`<\/sub>\n<sub>User: `@alice`<\/sub>/);
  assert.deepEqual(buildHistory([{ id: 1, author: 'bot', body: full }])[0], { role: 'assistant', content: 'Answer.' });
});

test("replies with the pre-1.11.1 marker still count as the agent's own", () => {
  const body = 'Old answer.\n\n<sub>Model: `m/x`</sub>\n<!-- git-server-agents -->';
  const errorBody = 'x\n<!-- git-server-agents -->\n<!-- git-server-agents:error -->';
  assert.deepEqual(buildHistory([{ id: 1, author: 'bot', body }, { id: 2, author: 'bot', body: errorBody }]), [
    { role: 'assistant', content: 'Old answer.' },
  ]);
});
