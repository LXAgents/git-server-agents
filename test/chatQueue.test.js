const test = require('node:test');
const assert = require('node:assert/strict');
const { enqueue, toHistory, withSessionTools, MAX_QUEUED } = require('../src/services/chat/chatAgent');
const { sessionGuide, joinMemory } = require('../src/services/chat/sessionTools');

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('a second question in a busy session waits for the first answer instead of being refused', async () => {
  const order = [];
  const first = deferred();
  const a = enqueue('s-queue', async () => {
    order.push('a start');
    await first.promise;
    order.push('a end');
  });
  const b = enqueue('s-queue', async () => order.push('b'));
  assert.deepEqual([a.state, b.state], ['answering', 'queued']);
  // Another session is not held up.
  const other = enqueue('s-other', async () => order.push('other'));
  assert.equal(other.state, 'answering');
  await other.running;
  first.resolve();
  await b.running;
  assert.deepEqual(order, ['a start', 'other', 'a end', 'b']);
  // The queue is gone once it drains, so the next question starts at once.
  assert.equal(enqueue('s-queue', async () => {}).state, 'answering');
});

test(`at most ${MAX_QUEUED} questions wait; a failed answer does not stop the queue`, async () => {
  const gate = deferred();
  const ran = [];
  const failing = enqueue('s-full', async () => {
    await gate.promise;
    throw new Error('the model failed');
  });
  const failed = assert.rejects(failing.running, /the model failed/);
  const waiting = [];
  for (let i = 0; i < MAX_QUEUED; i += 1) waiting.push(enqueue('s-full', async () => ran.push(i)));
  assert.ok(waiting.every((w) => w.state === 'queued'));
  assert.equal(enqueue('s-full', async () => ran.push('extra')).state, 'busy');
  gate.resolve();
  await failed;
  await waiting.at(-1).running;
  assert.deepEqual(ran, [0, 1, 2, 3, 4]);
});

test('history stops at the question, so questions queued after it are not shown as earlier', () => {
  const ev = (id, login, content, type = 'message') => ({ id, type, sender: { type: login ? 'user' : 'agent', login }, content });
  const events = [ev('1', 'alice', 'first'), ev('2', null, 'answer one'), ev('3', 'bob', 'second'), ev('4', 'alice', 'third'), ev('5', null, 'a report', 'report')];
  assert.deepEqual(toHistory(events, '3'), [
    { role: 'user', content: '@alice: first' },
    { role: 'assistant', content: 'answer one' },
  ]);
  // A question not in the list (not stored yet) sees everything.
  assert.equal(toHistory(events, 'x').length, 4);
});

test('session tools join the repository tools, and run without a repository', async () => {
  const session = { tools: [{ type: 'function', function: { name: 'list_sessions' } }], handlers: { list_sessions: async () => 'two sessions' } };
  const alone = withSessionTools(null, session);
  assert.deepEqual(alone.tools.map((t) => t.function.name), ['list_sessions']);
  assert.equal(await alone.run('list_sessions', '{}'), 'two sessions');
  assert.match(await alone.run('read_file', '{}'), /unknown tool read_file/);
  assert.equal(await alone.inlineContext('q'), '');
  const repo = { tools: [{ type: 'function', function: { name: 'read_file' } }], run: async (name) => `repo ran ${name}`, inlineContext: async () => 'files' };
  const both = withSessionTools(repo, session);
  assert.deepEqual(both.tools.map((t) => t.function.name), ['read_file', 'list_sessions']);
  assert.equal(await both.run('read_file', '{}'), 'repo ran read_file');
  assert.match(await both.run('list_sessions', 'not json'), /not valid JSON/);
  const failing = withSessionTools(null, { tools: [], handlers: { delete_session: async () => { throw new Error('nope'); } } });
  assert.match(await failing.run('delete_session', '{}'), /Error: delete_session failed \(nope\)/);
});

test('an agent session puts its AGENTS.md and MEMORY.md in the prompt; a team chat does not', () => {
  const agent = { id: 's1', title: 'Release bot', kind: 'agent', createdBy: 'github:1', agentsMd: 'Always answer in Thai.', memoryMd: '- v2 ships Friday' };
  const guide = sessionGuide(agent, { canEditAgents: true });
  assert.match(guide, /agent session "Release bot"/);
  assert.match(guide, /<agents_md>\nAlways answer in Thai.\n<\/agents_md>/);
  assert.match(guide, /<memory_md>\n- v2 ships Friday\n<\/memory_md>/);
  assert.match(guide, /update_agents_md only when the asker asks/);
  assert.match(sessionGuide({ ...agent, agentsMd: null, memoryMd: '' }, { canEditAgents: false }), /AGENTS.md is empty[\s\S]*MEMORY.md is empty[\s\S]*cannot change AGENTS.md/);
  const chat = sessionGuide({ id: 's2', title: 'Talk', kind: 'chat', createdBy: 'github:1' }, { canEditAgents: true });
  assert.doesNotMatch(chat, /AGENTS.md/);
  assert.match(chat, /list_sessions, create_session, rename_session and delete_session/);
  // The Agent activity session is an agent session even when stored as a chat one (before 1.21.0).
  assert.match(sessionGuide({ id: 's3', title: 'Agent activity', kind: 'chat', createdBy: null }, { canEditAgents: true }), /agent session "Agent activity"/);
});

test('update_memory appends a line by default and replaces on request', () => {
  assert.equal(joinMemory(null, '- one', 'append'), '- one');
  assert.equal(joinMemory('- one\n\n', '- two', undefined), '- one\n- two');
  assert.equal(joinMemory('- one', '# New', 'replace'), '# New');
});
