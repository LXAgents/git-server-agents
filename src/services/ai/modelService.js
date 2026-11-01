// Which provider and model a user, org or repo has picked, per modality, and each provider's
// live model catalogue.
const axios = require('axios');
const crypto = require('crypto');
require('../../http');
const prisma = require('../../db');
const config = require('../../config');
const { HttpError } = require('../../errors');
const llm = require('./llmService');
const { findProvider, providerParam, isValidModel } = require('./providers');

// The modalities the dashboard shows, in its order. Only text is used by the agent today.
const MODALITIES = ['text', 'image', 'video', 'speech', 'decisions', 'embeddings', 'rerank', 'transcription', 'audio'];
const AVAILABLE = new Set(['text']);

function settingView(row) {
  return { provider: row.provider || 'openrouter', model: row.model };
}

// `owner` is a where-fragment: { accountType, accountId }, { appInstallationId } or { repositoryId }.
// Returns { text: { provider, model }, ... }.
function settingsMap(rows) {
  return Object.fromEntries((rows || []).map((r) => [r.modality, settingView(r)]));
}

async function getModels(owner) {
  return settingsMap(await prisma.modelSetting.findMany({ where: owner }));
}

function modalityParam(value) {
  if (!MODALITIES.includes(value)) throw new HttpError(400, `modality must be one of ${MODALITIES.join(', ')}`);
  return value;
}

// Sets the owner's provider and model for one modality; an empty model clears it, so the owner
// falls back. A missing provider means OpenRouter, as before providers could be chosen.
async function setModel(owner, { modality, provider, model } = {}) {
  const kind = modalityParam(modality);
  const where = { ...owner, modality: kind };
  if (model === null || model === undefined || model === '') {
    await prisma.modelSetting.deleteMany({ where });
    return getModels(owner);
  }
  const chosen = providerParam(provider);
  const id = String(model).trim();
  if (!isValidModel(chosen, id)) throw new HttpError(400, `model must be a ${chosen.name} model id such as ${chosen.example}`);
  const data = { provider: chosen.slug, model: id };
  const existing = await prisma.modelSetting.findFirst({ where });
  if (existing) await prisma.modelSetting.update({ where: { id: existing.id }, data });
  else await prisma.modelSetting.create({ data: { ...where, ...data } });
  return getModels(owner);
}

async function firstModel(owner, modality) {
  return prisma.modelSetting.findFirst({ where: { ...owner, modality } });
}

// What "@agents" uses: the repo's provider and model, then the org's, then the user's, then
// DEFAULT_PROVIDER / DEFAULT_MODEL. Returns { provider, model, source }.
async function resolveModel({ repository, installation, account }, modality = 'text') {
  const chain = [
    ['repo', repository && { repositoryId: repository.id }],
    ['org', installation && { appInstallationId: installation.id }],
    ['user', account && { accountType: account.type, accountId: account.id }],
  ];
  for (const [source, owner] of chain) {
    if (!owner) continue;
    const row = await firstModel(owner, modality);
    if (row) return { ...settingView(row), source };
  }
  const fallback = findProvider(config.ai.defaultProvider) || findProvider('openrouter');
  return { provider: fallback.slug, model: config.ai.defaultModel, source: 'default' };
}

// Each provider's model list, fetched live and kept for a few minutes per provider and key, so
// a burst of searches in the dashboard costs one request.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

function toModel(m) {
  const pricing = m.pricing || {};
  const arch = m.architecture || {};
  const prompt = pricing.prompt === undefined ? null : String(pricing.prompt);
  const completion = pricing.completion === undefined ? null : String(pricing.completion);
  return {
    id: String(m.id),
    name: String(m.name || m.id),
    description: typeof m.description === 'string' ? m.description.slice(0, 300) : '',
    contextLength: Number(m.context_length) || null,
    pricing: { prompt, completion },
    free: String(m.id).endsWith(':free') || (Number(prompt) === 0 && Number(completion) === 0),
    inputModalities: Array.isArray(arch.input_modalities) ? arch.input_modalities : [],
    outputModalities: Array.isArray(arch.output_modalities) ? arch.output_modalities : [],
  };
}

// A row from another provider's /models, in the same shape as OpenRouter's. Those lists carry
// no prices or modalities, so the picker shows only the name, the id and the context length.
function toPlainModel(m, provider) {
  return {
    id: String(m.id),
    name: String(m.name || m.id),
    description: '',
    contextLength: Number(m.contextLength) || null,
    pricing: { prompt: null, completion: null },
    free: false,
    inputModalities: [],
    outputModalities: [],
    provider: provider.slug,
  };
}

async function fetchOpenRouter() {
  const { data } = await axios.get(`${config.ai.openRouterUrl}/models`, { timeout: 15_000 });
  return (Array.isArray(data && data.data) ? data.data : [])
    .filter((m) => m && m.id)
    .map((m) => ({ ...toModel(m), provider: 'openrouter' }))
    .filter((m) => m.outputModalities.length === 0 || m.outputModalities.includes('text'));
}

// z.ai documents its models but may not serve GET /models; these are its published GLM chat
// models, used only when that endpoint answers 404.
const ZAI_KNOWN = ['glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash'];

async function fetchWithKey(provider, apiKey) {
  try {
    const rows = await llm.listModels(provider.slug, { apiKey });
    return rows.map((m) => toPlainModel(m, provider)).sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    const status = err.response && err.response.status;
    if (provider.slug === 'zai' && status === 404) return ZAI_KNOWN.map((id) => toPlainModel({ id }, provider));
    throw err;
  }
}

const keyHash = (apiKey) => crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);

// The text models one provider offers. OpenRouter's list is public; the others are listed with
// `apiKey`, a key the caller brought for that provider (strict BYOK: the server has none).
async function listModels(modality = 'text', providerSlug = 'openrouter', { apiKey = null, now = Date.now() } = {}) {
  const kind = modalityParam(modality);
  if (!AVAILABLE.has(kind)) throw new HttpError(400, `${kind} models are not available yet`);
  const provider = providerParam(providerSlug);
  if (provider.keyForModels && !apiKey) {
    throw new HttpError(400, `add a ${provider.name} key first: ${provider.name} lists its models only to a key holder`);
  }
  const cacheKey = provider.keyForModels ? `${provider.slug}:${keyHash(apiKey)}` : provider.slug;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_MS) return hit.models;
  try {
    const models = provider.keyForModels ? await fetchWithKey(provider, apiKey) : await fetchOpenRouter();
    cache.set(cacheKey, { at: now, models });
    return models;
  } catch (err) {
    if (hit) return hit.models;
    const status = err.response && err.response.status;
    throw new HttpError(502, `could not load models from ${provider.name}: ${status ? `HTTP ${status}` : err.message}`);
  }
}

function clearCache() {
  cache.clear();
}

module.exports = { MODALITIES, getModels, setModel, resolveModel, listModels, clearCache, settingsMap };
