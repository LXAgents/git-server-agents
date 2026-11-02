const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

let server;
let base;
let openRouter;
let openAi;
let anthropic;
const { addDelta, readLine } = require('../src/services/ai/chatStream');

const sse = (res, chunks) => {
  res.set('content-type', 'text/event-stream');
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.post('/or/chat/completions', (req, res) => {
    assert.equal(req.body.stream, true);
    if (req.get('authorization') === 'Bearer bad') return res.status(401).json({ error: { message: 'No auth credentials found', code: 401 } });
    if (req.body.model === 'broken') return sse(res, [{ choices: [{ delta: { content: 'Hal' } }] }, { error: { message: 'upstream died', code: 502 } }]);
    return sse(res, [
      { choices: [{ delta: { role: 'assistant', content: 'Let me ' } }] },
      { choices: [{ delta: { content: 'look.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.js"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { cost: 0.0012 } },
    ]);
  });
  // Usage comes last, and only for providers asked for it with stream_options.
  app.post('/oa/chat/completions', (req, res) =>
    sse(res, [
      { choices: [{ delta: { content: 'Hi ' } }] },
      { choices: [{ delta: { content: 'there' } }] },
      ...(req.body.stream_options && req.body.stream_options.include_usage ? [{ choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } }] : []),
    ])
  );
  // Anthropic's Messages API stream.
  app.post('/an/v1/messages', (req, res) => {
    assert.equal(req.body.stream, true);
    res.set('content-type', 'text/event-stream');
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send('message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: req.body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Claude ' } });
    send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'streams' } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } });
    send('message_stop', {});
    res.end();
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  openRouter = require('../src/services/ai/openRouterService');
  openAi = require('../src/services/ai/openAiService');
  anthropic = require('../src/services/ai/anthropicService');
});

test.after(() => server.close());

test('OpenRouter streams text to onToken and rebuilds tool calls and cost', async () => {
  const tokens = [];
  const reply = await openRouter.complete({ baseUrl: `${base}/or`, apiKey: 'k', model: 'm', messages: [], onToken: (t) => tokens.push(t) });
  assert.deepEqual(tokens, ['Let me ', 'look.']);
  assert.equal(reply.content, 'Let me look.');
  assert.deepEqual(reply.tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }]);
  assert.equal(reply.cost, 0.0012);
});

test('errors inside the stream and HTTP errors keep their status and message', async () => {
  await assert.rejects(openRouter.complete({ baseUrl: `${base}/or`, apiKey: 'k', model: 'broken', messages: [], onToken: () => {} }), (err) => {
    assert.equal(err.response.status, 502);
    assert.equal(err.source, 'openrouter');
    return true;
  });
  await assert.rejects(openRouter.complete({ baseUrl: `${base}/or`, apiKey: 'bad', model: 'm', messages: [], onToken: () => {} }), (err) => {
    assert.equal(err.response.status, 401);
    assert.equal(err.response.data.error.message, 'No auth credentials found');
    return true;
  });
});

test('OpenAI-compatible providers stream too', async () => {
  const tokens = [];
  const reply = await openAi.complete({ baseUrl: `${base}/oa`, apiKey: 'k', model: 'm', messages: [], onToken: (t) => tokens.push(t), providerName: 'DeepSeek' });
  assert.deepEqual([reply.content, tokens.length], ['Hi there', 2]);
  assert.deepEqual(reply.tokens, { input: 12, output: 2 });
  // z.ai is not sent stream_options, so it reports no counts.
  const glm = await openAi.complete({ baseUrl: `${base}/oa`, apiKey: 'k', model: 'm', messages: [], onToken: () => {}, providerName: 'z.ai' });
  assert.equal(glm.tokens, null);
});

test('Anthropic streams through the SDK', async () => {
  const tokens = [];
  const reply = await anthropic.complete({ baseUrl: `${base}/an`, apiKey: 'k', model: 'claude-x', messages: [{ role: 'user', content: 'hi' }], onToken: (t) => tokens.push(t) });
  assert.deepEqual(tokens, ['Claude ', 'streams']);
  assert.equal(reply.content, 'Claude streams');
  assert.deepEqual(reply.tokens, { input: 1, output: 2 });
});

test('the parser ignores comments and bad lines and stops at [DONE]', () => {
  const state = { content: '', calls: [], usage: null, onToken: () => {} };
  assert.equal(readLine(state, ': keep-alive', () => {}), true);
  assert.equal(readLine(state, 'data: not json', () => {}), true);
  assert.equal(readLine(state, 'data: [DONE]', () => {}), false);
  addDelta(state, { tool_calls: [{ index: 1, id: 'b', function: { name: 'x', arguments: '{}' } }] });
  assert.equal(state.calls[1].id, 'b');
});
