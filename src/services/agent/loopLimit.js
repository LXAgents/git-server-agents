// How many tool rounds one answer may use. The commenter sets it in plain words ("run this 5
// times", "loop 10 times", "up to 4 rounds"); otherwise it is DEFAULT_TOOL_ROUNDS. The limit is
// capped by MAX_TOOL_ROUNDS, and the answer's time limit still applies on top of it.
const config = require('../../config');

const DEFAULT_TOOL_ROUNDS = 3;

const NUMBER_WORDS = {
  one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const NUMBER = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
const UNIT = '(?:times?|rounds?|iterations?|loops?|passes|steps|tries|attempts)';
// "5 times", "10 rounds", "twice": a count with its unit. "once"/"twice"/"thrice" need no unit.
const COUNTED = new RegExp(`\\b${NUMBER}\\s*(?:x\\b|${UNIT}\\b)|\\b(once|twice|thrice)\\b`, 'gi');
// The count only counts when the sentence asks to run, loop or repeat, so "I tried 3 times
// yesterday" in a question does not change the limit.
const VERB = /\b(run|loop|repeat|iterate|retry|try|do|go|use|take|spend|allow|limit|cap|max(?:imum)?|up to|at most)\b/i;

function toNumber(word) {
  const lower = word.toLowerCase();
  return lower in NUMBER_WORDS ? NUMBER_WORDS[lower] : Number.parseInt(lower, 10);
}

// The sentence (or line) around `index`, which is where the verb has to be.
function sentenceAround(text, index) {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'), before.lastIndexOf('?'), before.lastIndexOf('!')) + 1;
  return text.slice(start, index);
}

// { rounds, requested }: `requested` is the number the comment asked for, or null.
function parseLoopLimit(prompt, { max = config.ai.maxToolRounds } = {}) {
  const text = String(prompt || '');
  for (const match of text.matchAll(COUNTED)) {
    if (!VERB.test(sentenceAround(text, match.index) + match[0])) continue;
    const requested = toNumber(match[1] || match[2]);
    if (!Number.isFinite(requested) || requested < 1) continue;
    return { rounds: Math.min(requested, max), requested };
  }
  return { rounds: Math.min(DEFAULT_TOOL_ROUNDS, max), requested: null };
}

module.exports = { parseLoopLimit, DEFAULT_TOOL_ROUNDS };
