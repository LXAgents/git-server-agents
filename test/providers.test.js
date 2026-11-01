// The provider catalogue, the LLM routing layer and each provider's client, against the mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startMockPlatform, chatRequests } = require('./helpers/mockPlatform');

let mock;
let llm;
let anthropic;
let providers;
let agentErrors;

test.before(async () => {
  mock = await startMockPlatform();
  llm = require('../src/services/llmService');
  anthropic = require('../src/services/anthropicService');
  providers = require('../src/services/providers');
  agentErrors = require('../src/services/agentErrors');
});

test.after(() => mock.close());

test('finds providers by slug, display name or alias, and refuses unknown ones', () => {
  assert.equal(providers.findProvider('OpenAI').slug, 'openai');
  assert.equal(providers.findProvider('z.ai').slug, 'zai');
  assert.equal(providers.findProvider('GLM').slug, 'zai');
  assert.equal(providers.findProvider('acme'), null);
  assert.equal(providers.providerParam(undefined).slug, 'openrouter');
  assert.throws(() => providers.providerParam('acme'), /provider must be one of/);
  assert.equal(providers.isValidModel(providers.findProvider('openrouter'), 'openai/gpt-5'), true);
  assert.equal(providers.isValidModel(providers.findProvider('openrouter'), 'gpt-5'), false);
  assert.equal(providers.isValidModel(providers.findProvider('anthropic'), 'claude-opus-5-5'), true);
  assert.equal(providers.isValidModel(providers.findProvider('anthropic'), 'has space'), false);
});

test('routes OpenAI-compatible providers to /chat/completions with only known message fields', async () => {
  chatRequests.length = 0;
  const reply = await llm.complete({
    provider: 'openai',
    apiKey: 'sk-openai-good',
    model: 'gpt-5',
    messages: [
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: 'earlier', providerContent: [{ type: 'thinking' }] },
      { role: 'user', content: 'hi' },
    ],
  });
  assert.deepEqual(reply, { content: 'openai says hi to gpt-5', tool_calls: undefined, cost: null });
  assert.deepEqual(chatRequests[0].body.messages[1], { role: 'assistant', content: 'earlier' });
});

test('an OpenAI-compatible failure is tagged with the provider for the error reply', async () => {
  await assert.rejects(llm.complete({ provider: 'openai', apiKey: 'sk-bad', model: 'gpt-5', messages: [] }), (err) => {
    const info = agentErrors.classify(err);
    assert.equal(info.code, 'INVALID_API_KEY');
    assert.equal(info.status, 401);
    return true;
  });
  const down = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND', source: 'provider', providerName: 'DeepSeek' });
  assert.equal(agentErrors.classify(down).detail, 'DeepSeek could not be reached.');
});

test('routes Anthropic through the SDK: system prompt on top, max_tokens set, text back', async () => {
  chatRequests.length = 0;
  const reply = await llm.complete({
    provider: 'anthropic',
    apiKey: 'sk-ant-good',
    model: 'claude-opus-5-5',
    messages: [
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
    ],
  });
  assert.equal(reply.content, 'anthropic says hi to claude-opus-5-5');
  assert.equal(reply.cost, null);
  const { body } = chatRequests[0];
  assert.equal(body.system, 'SYS');
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
});

test('an Anthropic 401 reads as an invalid key', async () => {
  await assert.rejects(llm.complete({ provider: 'anthropic', apiKey: 'sk-ant-bad', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }), (err) => {
    assert.equal(err.source, 'provider');
    assert.equal(err.providerName, 'Anthropic');
    const info = agentErrors.classify(err);
    assert.equal(info.code, 'INVALID_API_KEY');
    assert.match(info.detail, /invalid x-api-key/);
    return true;
  });
});

test('translates tool calls and tool results to Anthropic blocks and back', () => {
  const { system, messages } = anthropic.toAnthropic([
    { role: 'system', content: 'A' },
    { role: 'system', content: 'B' },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'q' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'file text' },
    { role: 'user', content: 'Answer now' },
  ]);
  assert.equal(system, 'A\n\nB');
  assert.deepEqual(
    messages.map((m) => [m.role, m.content.map((b) => b.type)]),
    [
      ['user', ['text']],
      ['assistant', ['text']],
      ['user', ['text']],
      ['assistant', ['tool_use']],
      ['user', ['tool_result', 'text']],
    ]
  );
  assert.deepEqual(messages[3].content[0], { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.js' } });

  // A reply's own blocks (thinking included) go back unchanged.
  const raw = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't1', name: 'list_files', input: {} }];
  const reply = anthropic.fromAnthropic({ content: raw });
  assert.deepEqual(reply.tool_calls, [{ id: 't1', type: 'function', function: { name: 'list_files', arguments: '{}' } }]);
  const again = anthropic.toAnthropic([{ role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: reply.tool_calls, providerContent: reply.providerContent }]);
  assert.deepEqual(again.messages[1].content, raw);

  assert.deepEqual(anthropic.toAnthropicTools([{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object' } } }]), [
    { name: 'x', description: 'd', input_schema: { type: 'object' } },
  ]);
});
