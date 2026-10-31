const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComment, stripTrigger } = require('../src/services/commentParser');

test('uses the model on line 1 and the rest as the prompt', () => {
  const parsed = parseComment('@nvidia/nemotron-3.5-super-vl:free\nReview this\nplease');
  assert.deepEqual(parsed, { auto: false, model: 'nvidia/nemotron-3.5-super-vl:free', prompt: 'Review this\nplease' });
});

test('handles CRLF line endings', () => {
  assert.deepEqual(parseComment('@openai/gpt-4o\r\nWhy?'), { auto: false, model: 'openai/gpt-4o', prompt: 'Why?' });
});

test('names no model when line 1 is not @vendor/model, so the agent stays silent', () => {
  assert.deepEqual(parseComment('Explain this change'), { auto: false, model: null, prompt: 'Explain this change' });
  assert.equal(parseComment('@alice can you look?').model, null);
  assert.equal(parseComment('Hi\n@openai/gpt-4o\nwhy?').model, null);
  assert.equal(parseComment('').model, null);
});

test('returns an empty prompt for a model line alone', () => {
  assert.deepEqual(parseComment('@meta/llama-3'), { auto: false, model: 'meta/llama-3', prompt: '' });
});

test('@agents on line 1 asks for the stored model', () => {
  assert.deepEqual(parseComment('@agents\nWhy does this fail?'), { auto: true, model: null, prompt: 'Why does this fail?' });
  assert.deepEqual(parseComment('@Agents why does this fail?'), { auto: true, model: null, prompt: 'why does this fail?' });
  assert.equal(parseComment('Hi\n@agents why?').auto, false);
  assert.equal(parseComment('@agentsmith why?').auto, false);
});

test('the question can follow the model on the same line', () => {
  assert.deepEqual(parseComment('@openai/gpt-5 explain\nthis diff'), { auto: false, model: 'openai/gpt-5', prompt: 'explain\nthis diff' });
});

test('stripTrigger keeps only the question, for the history', () => {
  assert.equal(stripTrigger('@agents\nfirst'), 'first');
  assert.equal(stripTrigger('@openai/gpt-5 second'), 'second');
  assert.equal(stripTrigger('@alice look'), '@alice look');
});
