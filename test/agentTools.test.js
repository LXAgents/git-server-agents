const test = require('node:test');
const assert = require('node:assert/strict');

const openRouter = require('../src/services/ai/openRouterService');
const github = require('../src/services/platforms/githubService');
const { converse, buildToolGuide } = require('../src/services/agentService');
const { ANSWER_NOW } = require('../src/services/agent/conversation');
const { parseLoopLimit } = require('../src/services/agent/loopLimit');
const { createRepoTools, MAX_FILE_CHARS } = require('../src/services/agent/repoTools');

const FILES = { 'src/app.js': 'module.exports = app;', 'README.md': '# Hi', 'img/logo.png': 'PNG\u0000\u0001' };

function stubGithub(t) {
  t.mock.method(github, 'getRepoTree', async () => ({ paths: Object.keys(FILES), truncated: false }));
  t.mock.method(github, 'getFileContent', async (_repo, path) => (path in FILES ? FILES[path] : null));
}

const repoFor = () => createRepoTools({ platform: 'github', repo: 'acme/web', ref: 'abc123', token: 't' });
const base = { request: { baseUrl: 'https://or.test', model: 'vendor/model' }, apiKey: 'k', system: 'SYS', history: [] };

function httpError(status, data) {
  return Object.assign(new Error(`status ${status}`), { response: { status, data } });
}

test('the model lists files and reads one through tools, then answers', async (t) => {
  stubGithub(t);
  const seen = [];
  const replies = [
    { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_files', arguments: '{}' } }] },
    { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/app.js"}' } }] },
    { content: 'app.js exports the app.' },
  ];
  t.mock.method(openRouter, 'complete', async ({ messages, tools }) => {
    seen.push({ messages: structuredClone(messages), tools });
    return replies.shift();
  });
  const answer = await converse({ ...base, question: '@alice: What does app.js do?', repo: repoFor() });
  assert.equal(answer, 'app.js exports the app.');
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0].tools.map((tool) => tool.function.name), ['list_files', 'read_file']);
  const toolResults = seen[2].messages.filter((m) => m.role === 'tool');
  assert.match(toolResults[0].content, /3 files at abc123:\nsrc\/app.js/);
  assert.equal(toolResults[1].content, 'module.exports = app;');
  assert.equal(toolResults[1].tool_call_id, 'c2');
});

test('tool errors go back to the model instead of failing the task', async (t) => {
  stubGithub(t);
  const repo = repoFor();
  assert.match(await repo.run('read_file', '{"path":"nope.js"}'), /not found at abc123/);
  assert.match(await repo.run('read_file', '{"path":"img/logo.png"}'), /binary/);
  assert.match(await repo.run('read_file', 'not json'), /not valid JSON/);
  assert.match(await repo.run('delete_repo', '{}'), /unknown tool/);
  assert.match(await repo.run('list_files', '{"folder":"src/"}'), /1 files at abc123:\nsrc\/app.js$/);
});

test('long files are cut', async (t) => {
  t.mock.method(github, 'getFileContent', async () => 'a'.repeat(MAX_FILE_CHARS + 5));
  const text = await repoFor().readFile('big.txt');
  assert.match(text, /truncated at 40000 characters of 40005/);
});

test('a model without tool support gets the file list and named files in the prompt', async (t) => {
  stubGithub(t);
  t.mock.method(console, 'warn', () => {});
  const calls = [];
  t.mock.method(openRouter, 'complete', async ({ messages, tools }) => {
    calls.push({ messages, tools });
    if (tools) throw httpError(404, { error: { message: 'No endpoints found that support tool use' } });
    return { content: 'Here are your files.' };
  });
  const answer = await converse({ ...base, question: '@alice: What files do I have? Also explain app.js', repo: repoFor() });
  assert.equal(answer, 'Here are your files.');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].tools, undefined);
  const system = calls[1].messages[0].content;
  assert.match(system, /Repository files:\n3 files at abc123/);
  assert.match(system, /File src\/app.js:\n```\nmodule.exports = app;/);
  assert.doesNotMatch(system, /File README.md/);
});

test('other 400s are not mistaken for missing tool support', async (t) => {
  stubGithub(t);
  t.mock.method(openRouter, 'complete', async () => {
    throw httpError(400, { error: { message: 'invalid model id' } });
  });
  await assert.rejects(converse({ ...base, question: 'q', repo: repoFor() }), /status 400/);
});

test('stops calling tools after three rounds and asks for an answer', async (t) => {
  stubGithub(t);
  let calls = 0;
  t.mock.method(openRouter, 'complete', async ({ messages }) => {
    calls += 1;
    if (messages.at(-1).content === 'Answer now with what you have; do not call any more tools.') return { content: 'Final.' };
    return { content: '', tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: 'list_files', arguments: '{}' } }] };
  });
  assert.equal(await converse({ ...base, question: 'q', repo: repoFor() }), 'Final.');
  assert.equal(calls, 4);
});

test('the comment can set the tool rounds, and the model is told how many it has', async (t) => {
  stubGithub(t);
  const systems = [];
  let calls = 0;
  t.mock.method(openRouter, 'complete', async ({ messages }) => {
    calls += 1;
    systems.push(messages[0].content);
    if (messages.at(-1).content === ANSWER_NOW) return { content: 'Done.' };
    return { content: '', tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: 'list_files', arguments: '{}' } }] };
  });
  const { rounds } = parseLoopLimit('Run this 5 times and list the files');
  const answer = await converse({ ...base, toolGuide: buildToolGuide({ rounds }), question: '@alice: q', repo: repoFor(), maxRounds: rounds });
  assert.equal(answer, 'Done.');
  assert.equal(calls, 6);
  assert.match(systems[0], /^SYS\n\nTools:/);
  assert.match(systems[0], /you have 5 rounds/);
});

test('the no-tools fallback is not told about tools', async (t) => {
  stubGithub(t);
  t.mock.method(console, 'warn', () => {});
  const systems = [];
  t.mock.method(openRouter, 'complete', async ({ messages, tools }) => {
    systems.push(messages[0].content);
    if (tools) throw httpError(404, { error: { message: 'No endpoints found that support tool use' } });
    return { content: 'ok' };
  });
  await converse({ ...base, toolGuide: buildToolGuide({ rounds: 3 }), question: 'q', repo: repoFor() });
  assert.match(systems[0], /Tool rounds/);
  assert.doesNotMatch(systems[1], /Tool rounds|read_file reads/);
});

test('loop limits are read from plain words, default to 3 and are capped', () => {
  const cases = [
    ['Run this 5 times', 5],
    ['Loop this action 10 times please', 10],
    ['loop ten times over the files', 10],
    ['you can use up to 4 rounds', 4],
    ['repeat it twice', 2],
    ['Run once and tell me', 1],
    ['iterate 7x', 7],
    ['What does app.js do?', 3],
    ['I saw this fail 5 times yesterday. Why?', 3],
    ['Run it 0 times', 3],
  ];
  for (const [prompt, rounds] of cases) assert.equal(parseLoopLimit(prompt, { max: 20 }).rounds, rounds, prompt);
  assert.deepEqual(parseLoopLimit('run this 50 times', { max: 20 }), { rounds: 20, requested: 50 });
  assert.deepEqual(parseLoopLimit('hello', { max: 20 }), { rounds: 3, requested: null });
  assert.equal(parseLoopLimit('hello', { max: 2 }).rounds, 2);
});
