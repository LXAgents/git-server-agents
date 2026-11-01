// The AI providers the agent can call. Every key is brought by a user, an org or a repo
// (strict BYOK): nothing here holds a key. The Provider table mirrors this list (see
// prisma/seed.js); `slug` is the stable name the API and ModelSetting use.
const config = require('../../config');
const { HttpError } = require('../../errors');
const { MODEL_ID: OPENROUTER_MODEL } = require('../commentParser');

// OpenRouter ids are always "vendor/name"; the other providers use bare ids such as
// "gpt-5", "claude-opus-5-5", "deepseek-chat" or "glm-4.6".
const BARE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;

const PROVIDERS = [
  {
    slug: 'openrouter',
    name: 'OpenRouter',
    api: 'openrouter',
    url: () => config.ai.openRouterUrl,
    modelPattern: OPENROUTER_MODEL,
    example: 'openai/gpt-5',
    // OpenRouter's model list is public; every other provider's needs a key.
    keyForModels: false,
    reportsCost: true,
  },
  { slug: 'openai', name: 'OpenAI', api: 'openai', url: () => config.ai.openAiUrl, modelPattern: BARE_MODEL, example: 'gpt-5', keyForModels: true, reportsCost: false },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    api: 'anthropic',
    url: () => config.ai.anthropicUrl,
    modelPattern: BARE_MODEL,
    example: 'claude-opus-5-5',
    keyForModels: true,
    reportsCost: false,
  },
  { slug: 'deepseek', name: 'DeepSeek', api: 'openai', url: () => config.ai.deepSeekUrl, modelPattern: BARE_MODEL, example: 'deepseek-chat', keyForModels: true, reportsCost: false },
  { slug: 'zai', name: 'z.ai', api: 'openai', url: () => config.ai.zaiUrl, modelPattern: BARE_MODEL, example: 'glm-4.6', keyForModels: true, reportsCost: false },
];

const ALIASES = new Map([
  ['z.ai', 'zai'],
  ['glm', 'zai'],
  ['zhipu', 'zai'],
]);

// The provider for a slug or display name, in any case; null when unknown.
function findProvider(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().toLowerCase();
  const slug = ALIASES.get(key) || key;
  return PROVIDERS.find((p) => p.slug === slug || p.name.toLowerCase() === key) || null;
}

// Like findProvider, but a 400 for an unknown value. Empty means OpenRouter, so callers that
// predate providers keep working.
function providerParam(value, fallback = 'openrouter') {
  if (value === undefined || value === null || value === '') return findProvider(fallback);
  const provider = findProvider(String(value));
  if (!provider) throw new HttpError(400, `provider must be one of ${PROVIDERS.map((p) => p.slug).join(', ')}`);
  return provider;
}

function isValidModel(provider, model) {
  return typeof model === 'string' && model.length <= 200 && provider.modelPattern.test(model);
}

// What the dashboard's provider dropdown shows.
function providerView(p) {
  return { id: p.slug, name: p.name, example: p.example, keyForModels: p.keyForModels, reportsCost: p.reportsCost };
}

function listProviders() {
  return PROVIDERS.map(providerView);
}

module.exports = { PROVIDERS, OPENROUTER_MODEL, findProvider, providerParam, isValidModel, listProviders, providerView };
