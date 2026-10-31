const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHistory, buildSystemPrompt } = require('../src/services/agentService');
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

test('the system prompt handles an issue with no diff and mentions the tools', () => {
  const prompt = buildSystemPrompt({ platform: 'gitlab', kind: 'issue', title: 'Bug', description: '' }, '', { tools: true });
  assert.match(prompt, /gitlab issue/);
  assert.match(prompt, /list_files/);
  assert.doesNotMatch(prompt, /Diff:/);
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

test('the Model, Cost and User footer is left out of the history', () => {
  const body = `Answer.\n\n<sub>Model: \`m/x\`</sub>\n<sub>Cost: \`0.0001 USD\`</sub>\n<sub>User: \`@alice\`</sub>\n${REPLY_MARKER}`;
  const [message] = buildHistory([{ id: 1, author: 'bot', body }]);
  assert.deepEqual(message, { role: 'assistant', content: 'Answer.' });
});
