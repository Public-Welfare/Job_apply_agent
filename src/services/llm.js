'use strict';

/**
 * LLM provider resolution. Prefers a locally-running Ollama; if Ollama isn't
 * reachable, falls back to a hosted OpenAI-compatible provider using an API
 * token (several offer a generous free tier). The token can come from the
 * environment or be set at runtime via the dashboard (persisted to
 * data/llm.json), so a deployed instance works without any local LLM.
 *
 * Every consumer calls `await getLlmClient()` → { client, model, provider }.
 */

const fs = require('fs');
const OpenAI = require('openai');
const { config } = require('../config');
const { getMeta } = require('./metaService');

// OpenAI-compatible providers with a free tier. Each: base URL + a sensible
// default model + where to grab a free key.
const PROVIDERS = {
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keysUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keysUrl: 'https://openrouter.ai/keys',
  },
  gemini: {
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.0-flash',
    keysUrl: 'https://aistudio.google.com/apikey',
  },
  cerebras: {
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    keysUrl: 'https://cloud.cerebras.ai/',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
};

const TOKEN_PATH = config.LLM_TOKEN_PATH; // legacy file — migrated into the meta table
const META_KEY = 'llm_token';

let cache = null; // { at:number, result }

function loadRuntime() {
  const meta = getMeta();
  const fromDb = meta.getJson(META_KEY);
  if (fromDb) return fromDb;
  // One-time import of the legacy data/llm.json into the meta table.
  try {
    const obj = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    meta.setJson(META_KEY, obj);
    fs.renameSync(TOKEN_PATH, TOKEN_PATH + '.migrated');
    return obj;
  } catch {
    return {};
  }
}

function saveRuntime(obj) {
  getMeta().setJson(META_KEY, obj);
}

// Resolve the effective API config from runtime (dashboard) then env.
function apiConfig() {
  const rt = loadRuntime();
  const provider = rt.provider || config.LLM_PROVIDER || 'groq';
  const preset = PROVIDERS[provider] || null;
  const key = rt.api_key || config.LLM_API_KEY || '';
  const baseURL = config.LLM_BASE_URL || (preset && preset.baseURL) || '';
  const model = rt.model || config.LLM_MODEL || (preset && preset.model) || '';
  return { provider, key, baseURL, model, preset };
}

async function ollamaUp() {
  try {
    const url = `${config.OLLAMA_URL.replace(/\/$/, '')}/models`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      return r.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function resolve() {
  // 1. Local Ollama, if running.
  if (await ollamaUp()) {
    return {
      client: new OpenAI({ baseURL: config.OLLAMA_URL, apiKey: 'ollama' }),
      model: config.OLLAMA_MODEL,
      provider: 'ollama',
    };
  }
  // 2. Hosted provider via token (runtime or env).
  const a = apiConfig();
  if (a.key && a.baseURL && a.model) {
    return {
      client: new OpenAI({ baseURL: a.baseURL, apiKey: a.key }),
      model: a.model,
      provider: a.provider,
    };
  }
  // 3. Nothing available.
  const err = new Error(
    'No AI backend available. Start Ollama (ollama serve), or add a free AI API token in the dashboard (e.g. Groq — free at console.groq.com/keys).'
  );
  err.code = 'NO_LLM';
  throw err;
}

/** Returns { client, model, provider }. Cached ~30s to avoid re-probing. */
async function getLlmClient() {
  if (cache && Date.now() - cache.at < 30000) return cache.result;
  const result = await resolve();
  cache = { at: Date.now(), result };
  return result;
}

/** Non-throwing status for the dashboard. */
async function status() {
  const ollama = await ollamaUp();
  const a = apiConfig();
  const hasToken = !!(a.key && a.baseURL && a.model);
  return {
    available: ollama || hasToken,
    source: ollama ? 'ollama' : hasToken ? 'token' : null,
    provider: ollama ? 'ollama' : hasToken ? a.provider : null,
    model: ollama ? config.OLLAMA_MODEL : hasToken ? a.model : null,
    needs_token: !ollama && !hasToken,
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([k, v]) => [k, { label: v.label, keysUrl: v.keysUrl, model: v.model }])
    ),
  };
}

/** Persist a runtime API token/provider (set from the dashboard). */
function setToken({ provider, api_key, model } = {}) {
  if (!api_key || !String(api_key).trim()) {
    throw Object.assign(new Error('api_key is required'), { code: 'BAD_TOKEN' });
  }
  if (!PROVIDERS[provider] && !config.LLM_BASE_URL) {
    throw Object.assign(new Error(`Unknown provider "${provider}"`), { code: 'BAD_PROVIDER' });
  }
  const obj = { provider, api_key: String(api_key).trim() };
  if (model) obj.model = model;
  saveRuntime(obj);
  cache = null; // force re-resolve on next use
  return status();
}

function clearToken() {
  getMeta().delete(META_KEY);
  try {
    fs.unlinkSync(TOKEN_PATH); // clean up a legacy file too, if present
  } catch {
    /* ignore */
  }
  cache = null;
}

module.exports = { getLlmClient, status, setToken, clearToken, PROVIDERS };
