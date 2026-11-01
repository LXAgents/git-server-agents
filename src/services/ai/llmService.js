// One entry point for every AI provider. The agent resolves a provider slug and a model, and
// this module routes the call to the provider's client. Every client returns the same shape:
// { content, tool_calls?, cost } (cost in US dollars, or null when the provider reports none).
const openRouter = require('./openRouterService');
const openAi = require('./openAiService');
const anthropic = require('./anthropicService');
const { findProvider } = require('./providers');

// No provider means OpenRouter, the only one before 1.13.0.
function providerFor(slug = 'openrouter') {
  const provider = findProvider(slug);
  if (!provider) throw new Error(`unknown provider ${slug}`);
  return provider;
}

// `request` is { provider, baseUrl, apiKey, model, messages, tools?, timeout?, onToken? }; with
// onToken the reply is streamed and each piece of text is passed to it as it arrives. The clients
// are looked up on their modules at call time, so tests can mock them.
async function complete({ provider: slug, ...request }) {
  const provider = providerFor(slug);
  const baseUrl = request.baseUrl || provider.url();
  if (provider.api === 'openrouter') return openRouter.complete({ ...request, baseUrl });
  if (provider.api === 'anthropic') return anthropic.complete({ ...request, baseUrl });
  return openAi.complete({ ...request, baseUrl, providerName: provider.name });
}

// The provider's live model list as raw { id, name, ... } rows; see modelService.listModels.
async function listModels(slug, { apiKey, baseUrl } = {}) {
  const provider = providerFor(slug);
  const url = baseUrl || provider.url();
  if (provider.api === 'anthropic') return anthropic.listModels({ baseUrl: url, apiKey });
  return openAi.listModels({ baseUrl: url, apiKey, providerName: provider.name });
}

function emptyError(model) {
  return openAi.emptyError(model);
}

module.exports = { complete, listModels, emptyError };
