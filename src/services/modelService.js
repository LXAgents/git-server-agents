// Which model a user, org or repo has picked, per modality, and the live OpenRouter catalogue.
const axios = require('axios');
const prisma = require('../db');
const config = require('../config');
const { HttpError } = require('../errors');
const { MODEL_ID } = require('./commentParser');

// The modalities the dashboard shows, in its order. Only text is used by the agent today.
const MODALITIES = ['text', 'image', 'video', 'speech', 'decisions', 'embeddings', 'rerank', 'transcription', 'audio'];
const AVAILABLE = new Set(['text']);

// `owner` is a where-fragment: { accountType, accountId }, { appInstallationId } or { repositoryId }.
async function getModels(owner) {
  const rows = await prisma.modelSetting.findMany({ where: owner });
  return Object.fromEntries(rows.map((r) => [r.modality, r.model]));
}

function modalityParam(value) {
  if (!MODALITIES.includes(value)) throw new HttpError(400, `modality must be one of ${MODALITIES.join(', ')}`);
  return value;
}

// Sets the owner's model for one modality; an empty model clears it, so the owner falls back.
async function setModel(owner, { modality, model } = {}) {
  const kind = modalityParam(modality);
  const where = { ...owner, modality: kind };
  if (model === null || model === undefined || model === '') {
    await prisma.modelSetting.deleteMany({ where });
    return getModels(owner);
  }
  const id = String(model).trim();
  if (id.length > 200 || !MODEL_ID.test(id)) throw new HttpError(400, 'model must be an OpenRouter model id such as openai/gpt-5');
  const existing = await prisma.modelSetting.findFirst({ where });
  if (existing) await prisma.modelSetting.update({ where: { id: existing.id }, data: { model: id } });
  else await prisma.modelSetting.create({ data: { ...where, model: id } });
  return getModels(owner);
}

async function firstModel(owner, modality) {
  const row = await prisma.modelSetting.findFirst({ where: { ...owner, modality } });
  return row ? row.model : null;
}

// The model "@agents" uses: the repo's, then the org's, then the user's, then the default.
async function resolveModel({ repository, installation, account }, modality = 'text') {
  const chain = [
    ['repo', repository && { repositoryId: repository.id }],
    ['org', installation && { appInstallationId: installation.id }],
    ['user', account && { accountType: account.type, accountId: account.id }],
  ];
  for (const [source, owner] of chain) {
    if (!owner) continue;
    const model = await firstModel(owner, modality);
    if (model) return { model, source };
  }
  return { model: config.ai.defaultModel, source: 'default' };
}

// OpenRouter's model list, fetched live and kept for a few minutes so a burst of searches in
// the dashboard costs one request.
const CACHE_MS = 5 * 60 * 1000;
let cache = null;

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

async function fetchCatalogue(now) {
  if (cache && now - cache.at < CACHE_MS) return cache.models;
  try {
    const { data } = await axios.get(`${config.ai.openRouterUrl}/models`, { timeout: 15_000 });
    const models = (Array.isArray(data && data.data) ? data.data : []).filter((m) => m && m.id).map(toModel);
    cache = { at: now, models };
    return models;
  } catch (err) {
    if (cache) return cache.models;
    throw new HttpError(502, `could not load models from OpenRouter: ${err.message}`);
  }
}

async function listModels(modality = 'text', now = Date.now()) {
  const kind = modalityParam(modality);
  if (!AVAILABLE.has(kind)) throw new HttpError(400, `${kind} models are not available yet`);
  const models = await fetchCatalogue(now);
  return models.filter((m) => m.outputModalities.length === 0 || m.outputModalities.includes('text'));
}

function clearCache() {
  cache = null;
}

module.exports = { MODALITIES, getModels, setModel, resolveModel, listModels, clearCache };
