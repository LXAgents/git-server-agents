// Line 1 of a comment decides whether the agent answers, and with which model:
//   "@agents …"          use the model stored for the repo, org or user (see modelService)
//   "@vendor/model …"    use that OpenRouter model, e.g. "@nvidia/nemotron-3.5-super-vl:free"
// The question may follow on the same line or on the next lines. Model ids are always
// "vendor/name", so "@alice can you look?" is an ordinary mention, not a request.
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:+-]+$/;
const AGENTS = '@agents';

// The first whitespace-separated word of a line, and the rest of it.
function splitFirstWord(line) {
  const match = /\s/.exec(line);
  return match ? [line.slice(0, match.index), line.slice(match.index + 1).trim()] : [line, ''];
}

// The trigger word on line 1: { auto: true } for @agents, { model } for @vendor/model, or null.
function readTrigger(word) {
  if (word.toLowerCase() === AGENTS) return { auto: true, model: null };
  if (word.startsWith('@') && MODEL_ID.test(word.slice(1))) return { auto: false, model: word.slice(1) };
  return null;
}

function parseComment(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const newline = text.indexOf('\n');
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim();
  const rest = newline === -1 ? '' : text.slice(newline + 1);
  const [word, sameLine] = splitFirstWord(firstLine);
  const trigger = readTrigger(word);
  if (!trigger) return { auto: false, model: null, prompt: text.trim() };
  return { ...trigger, prompt: [sameLine, rest].join('\n').trim() };
}

// The comment without its trigger word, for the conversation history.
function stripTrigger(body) {
  const parsed = parseComment(body);
  return parsed.auto || parsed.model ? parsed.prompt : String(body || '').replace(/\r\n/g, '\n').trim();
}

module.exports = { parseComment, stripTrigger, MODEL_ID };
