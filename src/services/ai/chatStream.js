// Streaming Chat Completions (OpenRouter and the OpenAI-compatible providers). The reply comes
// as Server-Sent Events; every text delta goes to onToken as it arrives, and the pieces are put
// back together into the same { content, tool_calls?, usage } a non-streaming call returns.
const axios = require('axios');

// Reads a whole stream (an error body that came back streamed) into text.
async function readAll(stream) {
  if (!stream || typeof stream.on !== 'function') return stream;
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// An error response read back into JSON, so agentErrors sees the provider's message as usual.
async function settleErrorBody(err) {
  if (!err.response) return err;
  const text = await readAll(err.response.data).catch(() => '');
  if (typeof text === 'string') {
    try {
      err.response.data = JSON.parse(text);
    } catch {
      err.response.data = text;
    }
  }
  return err;
}

// Adds one chunk's delta to the reply being built. Tool calls arrive in pieces by index: the
// first piece has the id and name, later ones add to the arguments.
function addDelta(state, delta) {
  if (typeof delta.content === 'string' && delta.content) {
    state.content += delta.content;
    state.onToken(delta.content);
  }
  for (const part of delta.tool_calls || []) {
    const index = Number.isInteger(part.index) ? part.index : state.calls.length;
    const call = state.calls[index] || (state.calls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
    if (part.id) call.id = part.id;
    if (part.function && part.function.name) call.function.name += part.function.name;
    if (part.function && typeof part.function.arguments === 'string') call.function.arguments += part.function.arguments;
  }
}

// Handles one SSE line. Returns false after [DONE].
function readLine(state, line, onError) {
  if (!line.startsWith('data:')) return true;
  const data = line.slice(5).trim();
  if (data === '[DONE]') return false;
  let chunk;
  try {
    chunk = JSON.parse(data);
  } catch {
    return true;
  }
  const choice = chunk.choices && chunk.choices[0];
  const error = chunk.error || (choice && choice.error);
  if (error) {
    onError(error);
    return false;
  }
  if (chunk.usage) state.usage = chunk.usage;
  if (choice && choice.delta) addDelta(state, choice.delta);
  return true;
}

// POSTs `body` with stream: true to `url` and resolves to { content, tool_calls?, usage }.
// `bodyError(status, error)` builds the error for a failure reported inside the stream.
// The whole stream, not only its first byte, must end within `timeout`.
async function streamCompletion({ url, headers, body, timeout, onToken, bodyError }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  try {
    return await readStream({ url, headers, body, timeout, onToken, bodyError, signal: abort.signal });
  } catch (err) {
    if (abort.signal.aborted && !err.response) {
      const timedOut = new Error(`no complete answer within ${timeout}ms`);
      timedOut.code = 'ETIMEDOUT';
      timedOut.config = { timeout };
      throw timedOut;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readStream({ url, headers, body, timeout, onToken, bodyError, signal }) {
  let res;
  try {
    res = await axios.post(url, { ...body, stream: true }, { headers: { ...headers, Accept: 'text/event-stream' }, timeout, responseType: 'stream', signal });
  } catch (err) {
    throw await settleErrorBody(err);
  }
  const state = { content: '', calls: [], usage: null, onToken: (t) => onToken(t) };
  let failure = null;
  const onError = (error) => {
    failure = bodyError(Number(error.code) || 502, error);
  };
  let buffer = '';
  let open = true;
  for await (const chunk of res.data) {
    buffer += Buffer.from(chunk).toString('utf8');
    let cut;
    while (open && (cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).replace(/\r$/, '');
      buffer = buffer.slice(cut + 1);
      open = readLine(state, line, onError);
    }
    if (!open) break;
  }
  if (open && buffer.trim()) readLine(state, buffer.trim(), onError);
  if (typeof res.data.destroy === 'function') res.data.destroy();
  if (failure) throw failure;
  const calls = state.calls.filter(Boolean);
  return { content: state.content, tool_calls: calls.length ? calls : undefined, usage: state.usage };
}

module.exports = { streamCompletion, addDelta, readLine };
