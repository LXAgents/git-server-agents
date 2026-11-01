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

const { createThreadActions } = require('../src/services/agent/threadActions');
const gitlab = require('../src/services/platforms/gitlabService');

const issueThread = { kind: 'issue', number: 3, repo: 'acme/web', projectId: 12 };
const manageRepo = (platform = 'github', thread = issueThread) =>
  createRepoTools({ platform, repo: 'acme/web', projectId: 12, ref: 'abc123', token: 't' }, { actions: createThreadActions({ platform, thread, token: 't', asker: 'alice' }) });

test('the issue tools are only offered with actions, with clear schemas', () => {
  assert.deepEqual(repoFor().tools.map((tool) => tool.function.name), ['list_files', 'read_file']);
  const tools = manageRepo().tools;
  assert.deepEqual(tools.map((tool) => tool.function.name), ['list_files', 'read_file', 'create_issue', 'close_issue', 'reopen_issue']);
  const create = tools.find((tool) => tool.function.name === 'create_issue').function;
  assert.deepEqual(create.parameters.required, ['title']);
  assert.ok(create.parameters.properties.body);
  assert.equal(tools.find((tool) => tool.function.name === 'close_issue').function.parameters.properties.number.type, 'integer');
});

test('create, close and reopen issues on GitHub, defaulting to this thread', async (t) => {
  t.mock.method(github, 'createIssue', async (_repo, fields) => ({ number: 9, url: 'https://gh/acme/web/issues/9', state: 'open', fields }));
  t.mock.method(github, 'setIssueState', async (_repo, number, state) => ({ number, state, url: `https://gh/acme/web/issues/${number}` }));
  const repo = manageRepo();
  assert.equal(await repo.run('create_issue', '{"title":" Flaky test ","body":"It fails","labels":["bug"]}'), 'Created issue #9: https://gh/acme/web/issues/9');
  const [, fields] = github.createIssue.mock.calls[0].arguments;
  assert.equal(fields.title, 'Flaky test');
  assert.deepEqual(fields.labels, ['bug']);
  assert.match(fields.body, /^It fails\n\n<sub>Opened by LXAgents for `@alice`<\/sub>$/);
  assert.equal(await repo.run('close_issue', '{}'), 'Issue #3 is now closed: https://gh/acme/web/issues/3');
  assert.equal(await repo.run('reopen_issue', '{"number":"#5"}'), 'Issue #5 is now open: https://gh/acme/web/issues/5');
  assert.deepEqual(github.setIssueState.mock.calls[0].arguments.slice(0, 4), ['acme/web', 3, 'closed', { reason: 'completed' }]);
  assert.deepEqual(github.setIssueState.mock.calls[1].arguments.slice(0, 4), ['acme/web', 5, 'open', { reason: undefined }]);
});

test('GitLab issue tools use the project id', async (t) => {
  t.mock.method(gitlab, 'createIssue', async () => ({ number: 2, url: 'https://gl/grp/app/-/issues/2', state: 'opened' }));
  t.mock.method(gitlab, 'setIssueState', async (_p, number) => ({ number, state: 'closed', url: 'u' }));
  const repo = manageRepo('gitlab');
  assert.match(await repo.run('create_issue', '{"title":"T"}'), /Created issue #2/);
  assert.equal(gitlab.createIssue.mock.calls[0].arguments[0], 12);
  await repo.run('close_issue', '{"number":7}');
  assert.deepEqual(gitlab.setIssueState.mock.calls[0].arguments, [12, 7, 'closed']);
});

test('bad arguments and platform refusals come back to the model as errors', async (t) => {
  const repo = manageRepo('github', { kind: 'pull_request', number: 8, repo: 'acme/web' });
  t.mock.method(github, 'createIssue', async () => {
    throw httpError(422, { message: 'Validation Failed', errors: [{ message: 'label does not exist' }] });
  });
  t.mock.method(github, 'setIssueState', async (_repo, number) => {
    if (number === 8) throw Object.assign(new Error('#8 is a pull request, not an issue'), { notIssue: true });
    throw httpError(403, { message: 'Resource not accessible by integration' });
  });
  assert.equal(await repo.run('create_issue', '{}'), 'Error: create_issue: a non-empty "title" is required.');
  assert.match(await repo.run('create_issue', '{"title":"x","labels":"bug"}'), /"labels" must be a list/);
  assert.equal(await repo.run('create_issue', '{"title":"x"}'), 'Error: create_issue failed (HTTP 422: Validation Failed; label does not exist).');
  assert.equal(await repo.run('close_issue', '{}'), 'Error: close_issue: this comment is not on an issue, so give the issue "number".');
  assert.equal(await repo.run('close_issue', '{"number":"abc"}'), 'Error: close_issue: "number" must be a positive issue number such as 12.');
  assert.equal(await repo.run('close_issue', '{"number":8}'), 'Error: close_issue: #8 is a pull request, not an issue.');
  assert.match(await repo.run('close_issue', '{"number":4}'), /HTTP 403: Resource not accessible by integration\)\. The app may lack the permission/);
  assert.match(await repoFor().run('close_issue', '{}'), /unknown tool close_issue/);
});
