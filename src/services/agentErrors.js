// Turns any failure while answering a comment into something the commenter can act on: a
// stable code, the HTTP status when there was one, what happened, and whether retrying helps.
// The reply never carries a key, a stack trace or internal paths.

// An error the agent raises itself, with a code from CODES.
class AgentError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const CODES = {
  NO_QUESTION: { title: 'No question to answer', retry: 'Add your question after the trigger, on the same line or the next ones.' },
  NO_API_KEY: { title: 'No API key to use', retry: 'Retrying will not help. Add a key for that provider on the dashboard’s API keys page first.' },
  INVALID_API_KEY: { title: 'The API key was refused', retry: 'Retrying will not help. Replace the key on the dashboard: it is invalid, revoked or disabled.' },
  INSUFFICIENT_CREDITS: { title: 'The API key is out of credits', retry: 'Retrying will not help. Add credits with the provider (openrouter.ai/settings/credits for OpenRouter), or use a free model.' },
  RATE_LIMITED: { title: 'Rate limit reached', retry: 'Wait before retrying; asking again right away fails the same way.' },
  MODEL_NOT_FOUND: { title: 'The model was not found', retry: 'Retrying will not help. Check the model id in the dashboard’s model list for that provider.' },
  BAD_REQUEST: { title: 'The request was rejected', retry: 'Retrying will not help. Try another model, or a shorter question.' },
  CONTENT_FLAGGED: { title: 'The request was refused by moderation', retry: 'Retrying will not help. Rephrase the question, or try another model.' },
  TIMEOUT: { title: 'The model took too long', retry: 'Retry once; if it times out again, pick a faster model.' },
  PROVIDER_UNAVAILABLE: { title: 'The model is unavailable right now', retry: 'Retry in a few minutes, or pick another model.' },
  PROVIDER_ERROR: { title: 'The model provider failed', retry: 'Retry in a few minutes. If it keeps failing, pick another model.' },
  EMPTY_RESPONSE: { title: 'The model gave an empty answer', retry: 'Retry once, or pick another model.' },
  PLATFORM_ERROR: { title: 'GitHub or GitLab refused a request', retry: 'Retry in a few minutes. If it keeps failing, the app may be missing a permission.' },
  NO_WORKSPACE_KEY: { title: 'No Codespaces token to use', retry: 'Retrying will not help. Add a GitHub personal access token with the codespace scope on the dashboard’s API keys page.' },
  WORKSPACE_ERROR: { title: 'GitHub Codespaces refused a request', retry: 'Check that Codespaces is enabled for the repository and that the token has the codespace scope, then retry.' },
  WORKSPACE_UNAVAILABLE: { title: 'The workspace is not available', retry: 'Retry in a few minutes. If it keeps failing, the server may be missing the gh CLI.' },
  INTERNAL_ERROR: { title: 'The server hit an unexpected error', retry: 'Retry once. If it fails again, give the owner the task id below.' },
};

const MAX_DETAIL = 300;

// The provider's own message, made safe to quote: one line, capped, no backticks, and
// anything that looks like a key masked.
function quote(value) {
  let text = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replaceAll('`', "'")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')
    .trim();
  if (text.length > MAX_DETAIL) text = `${text.slice(0, MAX_DETAIL)}…`;
  return text;
}

function providerMessage(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const error = data.error;
  if (error && typeof error === 'object') {
    const raw = error.metadata && error.metadata.raw;
    const upstream = typeof raw === 'string' ? raw : '';
    return [error.message, upstream && upstream !== error.message ? upstream : ''].filter(Boolean).join(': ');
  }
  return typeof error === 'string' ? error : data.message || '';
}

// When a rate limit lifts, from Retry-After (seconds) or X-RateLimit-Reset (epoch ms or s).
function resetTime(headers, now = Date.now()) {
  if (!headers) return null;
  const get = (name) => (typeof headers.get === 'function' ? headers.get(name) : headers[name]);
  const retryAfter = Number(get('retry-after'));
  if (retryAfter > 0) return new Date(now + retryAfter * 1000);
  const reset = Number(get('x-ratelimit-reset'));
  if (reset > 0) return new Date(reset > 1e12 ? reset : reset * 1000);
  return null;
}

function codeForProviderStatus(status, message) {
  if (status === 401) return 'INVALID_API_KEY';
  if (status === 402) return 'INSUFFICIENT_CREDITS';
  if (status === 403) return /key|disabled|forbidden/i.test(message) && !/moderat|flag/i.test(message) ? 'INVALID_API_KEY' : 'CONTENT_FLAGGED';
  if (status === 404) return 'MODEL_NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 502 || status === 503) return 'PROVIDER_UNAVAILABLE';
  if (status >= 500) return 'PROVIDER_ERROR';
  if (status === 400 && /not a valid model|model.*(not found|does not exist|invalid)/i.test(message)) return 'MODEL_NOT_FOUND';
  return 'BAD_REQUEST';
}

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);

// One classified failure. `quoted` marks text that came from the AI provider or the platform.
function result(code, status, detail, { quoted = false, note = '', resetAt = null } = {}) {
  return { code, status, ...CODES[code], detail, quoted, note, resetAt };
}

function classifyProvider(e, now) {
  const name = e.providerName || 'OpenRouter';
  const response = e.response;
  if (!response) {
    if (e.deadline) return result('TIMEOUT', null, `The answer took longer than ${Math.round(e.deadline / 1000)} seconds, the limit for one comment.`);
    if (TIMEOUT_CODES.has(e.code) || /timeout/i.test(e.message)) {
      const ms = e.config && e.config.timeout;
      return result('TIMEOUT', null, ms ? `No answer within ${Math.round(ms / 1000)} seconds.` : 'The model did not answer in time.');
    }
    return result('PROVIDER_UNAVAILABLE', null, `${name} could not be reached.`);
  }
  const message = providerMessage(response.data);
  const code = codeForProviderStatus(response.status, message);
  const resetAt = code === 'RATE_LIMITED' ? resetTime(response.headers, now) : null;
  const note =
    code === 'RATE_LIMITED' && /free-models-per-day/i.test(message)
      ? 'The daily limit for free models on this key is used up. It resets at 00:00 UTC, and adding credits raises it.'
      : '';
  const detail = quote(message);
  if (!detail) return result(code, response.status, `${name} answered HTTP ${response.status}.`, { note, resetAt });
  return result(code, response.status, detail, { quoted: true, note, resetAt });
}

// { code, status, title, detail, retry, quoted, note, resetAt } for any error.
function classify(err, now = Date.now()) {
  const e = err || {};
  if (e instanceof AgentError) return result(e.code, null, e.message);
  if (e.code === 'NO_WORKSPACE_KEY') return result('NO_WORKSPACE_KEY', e.status || null, e.message);
  if (e.source === 'codespaces') {
    const code = CODES[e.code] ? e.code : 'WORKSPACE_ERROR';
    return result(code, (e.response && e.response.status) || null, quote(e.message), { quoted: true });
  }
  if (e.source === 'openrouter' || e.source === 'provider') return classifyProvider(e, now);
  if (e.source === 'empty') return result('EMPTY_RESPONSE', null, 'The model returned no text.');
  const response = e.response;
  if (response && response.status) {
    const detail = quote(providerMessage(response.data));
    if (!detail) return result('PLATFORM_ERROR', response.status, `HTTP ${response.status}.`);
    return result('PLATFORM_ERROR', response.status, detail, { quoted: true });
  }
  return result('INTERNAL_ERROR', null, 'Details are in the server log.');
}

function describeReset(resetAt, now) {
  const minutes = Math.max(1, Math.ceil((resetAt.getTime() - now) / 60_000));
  const at = resetAt.toISOString().slice(11, 16);
  const when = minutes >= 120 ? `about ${Math.round(minutes / 60)} hours` : `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `Retry after ${at} UTC (in ${when}); asking earlier fails the same way.`;
}

// The Markdown body of the error reply, without the marker.
function formatReply(err, { model, taskId, now = Date.now() } = {}) {
  const info = classify(err, now);
  const head = [`⚠️ **${info.title}**`, `\`${info.code}\``];
  if (info.status) head.push(`HTTP ${info.status}`);
  const detail = info.quoted ? `\`${info.detail}\`` : info.detail;
  const lines = [head.join(' · '), '', `**What happened:** ${[detail, info.note].filter(Boolean).join(' ')}`];
  lines.push(`**Retry:** ${info.resetAt ? describeReset(info.resetAt, now) : info.retry}`);
  const attempts = (err && err.attempts) || [];
  if (attempts.length > 1) {
    lines.push(`**Keys tried:** ${attempts.map((a) => `${a.owner} key (${a.status})`).join(', ')}`);
  }
  const footer = [model ? `Model: \`${model}\`` : null, taskId ? `Task: \`${taskId}\`` : null].filter(Boolean).join(' · ');
  if (footer) lines.push('', `<sub>${footer}</sub>`);
  return lines.join('\n');
}

module.exports = { AgentError, CODES, classify, formatReply, quote, resetTime };
