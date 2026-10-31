// Line 1 of a comment must name the OpenRouter model: "@nvidia/nemotron-3.5-super-vl:free".
// Model ids are always "vendor/name", so "@alice can you look?" is an ordinary mention, not a
// request. Without a model line the agent does not answer, and `model` is null.
const MODEL_LINE = /^@([A-Za-z0-9._-]+\/[A-Za-z0-9._:+-]+)\s*$/;

function parseComment(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const newline = text.indexOf('\n');
  const firstLine = (newline === -1 ? text : text.slice(0, newline)).trim();
  const match = firstLine.match(MODEL_LINE);
  if (!match) return { model: null, prompt: text.trim() };
  return { model: match[1], prompt: (newline === -1 ? '' : text.slice(newline + 1)).trim() };
}

module.exports = { parseComment, MODEL_LINE };
