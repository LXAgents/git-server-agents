// What a comment answer shows in the chat: progress, the answer's text while the model writes it,
// and a report at the end, in the commenter's user room and (when the repository is imported) the
// repository's room. Tokens are streamed only when someone has one of those rooms open, so an
// answer nobody watches is asked exactly as before.
const { broadcaster } = require('../chat');
const bus = require('../chat/bus');
const { AGENT } = require('../chat/events');
const { userRoomKey, repoRoomKey } = require('../chat/rooms');

// `where` names the thread ("acme/web#12"). Returns { progress, report, hooks }.
function chatFor({ task, comment, identity, repository, asker, where }) {
  const targets = [];
  if (identity.triggerUserId) targets.push({ key: userRoomKey(task.platform, identity.triggerUserId), room: `user:${identity.triggerUserId}` });
  if (repository) targets.push({ key: repoRoomKey(repository.id), room: `repo:${repository.id}` });
  const chat = broadcaster(targets);
  const base = { taskId: task.id, where, asker, kind: comment.kind, number: comment.number };
  const watched = () => targets.some((t) => bus.listenerCount(t.key) > 0);

  const progress = ({ tool, status, reset }) =>
    chat.live({ type: 'progress', sender: AGENT, content: status, data: { ...base, status, ...(tool ? { tool } : {}), ...(reset ? { reset: true } : {}) } });

  progress({ status: `Answering @${asker} on ${where}` });

  return {
    progress,
    // Stored in each room's "Agent activity" session.
    report: (content, data = {}) => chat.send({ type: 'report', sender: AGENT, content, data: { ...base, ...data } }),
    // The model-call hooks for conversation.timedCall and toolLoop.
    hooks: () => {
      const hooks = {
        onTool: (step) => progress(step),
        // Each model call starts a new piece of text: the client clears what it streamed so far.
        onRound: () => progress({ status: 'Thinking...', reset: true }),
      };
      if (watched()) hooks.onToken = (text) => chat.live({ type: 'token', sender: AGENT, content: text, data: { taskId: task.id } });
      return hooks;
    },
  };
}

module.exports = { chatFor };
