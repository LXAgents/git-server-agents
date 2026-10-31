// Removes trailing "/" characters in one pass. A regex such as /\/+$/ is quadratic on long
// runs of slashes, and some of these strings come from users or the model.
function trimTrailingSlashes(value) {
  const text = String(value);
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

// Makes a value from a request safe for one log line: control characters (CR, LF, tabs, ANSI
// escapes) become spaces and the value is capped, so it can't forge or flood log entries.
const MAX_LOG_VALUE = 200;
function logSafe(value) {
  let text = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    text += code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0x2028 || code === 0x2029 ? ' ' : ch;
    if (text.length >= MAX_LOG_VALUE) return `${text.slice(0, MAX_LOG_VALUE)}…`;
  }
  return text;
}

module.exports = { trimTrailingSlashes, logSafe };
