const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComment } = require('../src/services/commentParser');

const DEFAULT = 'openrouter/auto';

test('uses the model on line 1 and the rest as the prompt', () => {
  const parsed = parseComment('@nvidia/nemotron-3.5-super-vl:free\nReview this\nplease', DEFAULT);
  assert.deepEqual(parsed, { model: 'nvidia/nemotron-3.5-super-vl:free', prompt: 'Review this\nplease' });
});

test('handles CRLF line endings', () => {
  const parsed = parseComment('@openai/gpt-4o\r\nWhy?', DEFAULT);
  assert.deepEqual(parsed, { model: 'openai/gpt-4o', prompt: 'Why?' });
});

test('falls back to the default model without an @ line', () => {
  assert.deepEqual(parseComment('Explain this change', DEFAULT), { model: DEFAULT, prompt: 'Explain this change' });
});

test('treats a user mention as part of the prompt', () => {
  assert.deepEqual(parseComment('@alice can you look?', DEFAULT), { model: DEFAULT, prompt: '@alice can you look?' });
});

test('returns an empty prompt for a model line alone', () => {
  assert.deepEqual(parseComment('@meta/llama-3', DEFAULT), { model: 'meta/llama-3', prompt: '' });
});
