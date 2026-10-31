const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComment } = require('../src/services/commentParser');

test('uses the model on line 1 and the rest as the prompt', () => {
  const parsed = parseComment('@nvidia/nemotron-3.5-super-vl:free\nReview this\nplease');
  assert.deepEqual(parsed, { model: 'nvidia/nemotron-3.5-super-vl:free', prompt: 'Review this\nplease' });
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseComment('@openai/gpt-4o\r\nWhy?'), { model: 'openai/gpt-4o', prompt: 'Why?' });
});

test('names no model when line 1 is not @vendor/model, so the agent stays silent', () => {
  assert.deepEqual(parseComment('Explain this change'), { model: null, prompt: 'Explain this change' });
  assert.equal(parseComment('@alice can you look?').model, null);
  assert.equal(parseComment('Hi\n@openai/gpt-4o\nwhy?').model, null);
  assert.equal(parseComment('').model, null);
});

test('returns an empty prompt for a model line alone', () => {
  assert.deepEqual(parseComment('@meta/llama-3'), { model: 'meta/llama-3', prompt: '' });
});
