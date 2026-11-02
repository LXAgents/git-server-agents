const test = require('node:test');
const assert = require('node:assert/strict');
const { tokensOf } = require('../src/services/ai/usage');
const { newSpend, addCost, addTokens, usageData } = require('../src/services/agent/cost');

test('tokensOf reads Chat Completions and Anthropic usage', () => {
  assert.deepEqual(tokensOf({ prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }), { input: 120, output: 30 });
  assert.deepEqual(tokensOf({ input_tokens: 50, output_tokens: 9, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }), { input: 65, output: 9 });
  assert.equal(tokensOf(null), null);
  assert.equal(tokensOf({ cost: 0.1 }), null);
  assert.deepEqual(tokensOf({ prompt_tokens: -1, completion_tokens: 4 }), { input: 0, output: 4 });
});

test('usageData sums an answer and says when a call reported nothing', () => {
  const spend = newSpend();
  addCost(spend, 0.0002);
  addTokens(spend, { input: 100, output: 20 });
  addCost(spend, 0.0001);
  addTokens(spend, { input: 50, output: 5 });
  const full = usageData(spend);
  assert.equal(full.costComplete, true);
  assert.ok(Math.abs(full.costUsd - 0.0003) < 1e-12);
  assert.deepEqual({ i: full.inputTokens, o: full.outputTokens, t: full.tokensComplete }, { i: 150, o: 25, t: true });

  const unknown = newSpend();
  addCost(unknown, null);
  addTokens(unknown, null);
  assert.deepEqual(usageData(unknown), { costUsd: null, costComplete: false, inputTokens: 0, outputTokens: 0, tokensComplete: false });
});
