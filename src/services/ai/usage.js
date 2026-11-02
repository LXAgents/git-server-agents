// Token counts from a provider's `usage` block, as { input, output }: Chat Completions names them
// prompt_tokens / completion_tokens, Anthropic input_tokens / output_tokens (plus cache reads and
// writes, which are input too). Null when the provider sent no counts.
function count(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const cached = (count(usage.cache_creation_input_tokens) || 0) + (count(usage.cache_read_input_tokens) || 0);
  const input = count(usage.prompt_tokens ?? usage.input_tokens);
  const output = count(usage.completion_tokens ?? usage.output_tokens);
  if (input === null && output === null) return null;
  return { input: (input || 0) + cached, output: output || 0 };
}

module.exports = { tokensOf };
