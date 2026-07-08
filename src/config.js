'use strict';

const path = require('path');
require('dotenv').config({ quiet: true });

// config.js lives in src/, so the project root is one level up.
const BASE_DIR = path.resolve(__dirname, '..');

// Where generated resumes live (override via env for a mounted volume).
const RESUMES_DIR = process.env.RESUMES_DIR || path.join(BASE_DIR, 'resumes');

const bool = (v, dflt) =>
  v === undefined ? dflt : String(v).toLowerCase() === 'true';
const int = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : n;
};

const config = {
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:7b',

  // Fallback LLM (used when Ollama isn't reachable). Point at any free
  // OpenAI-compatible provider; a token can also be set at runtime via the
  // dashboard (persisted to data/llm.json), which takes precedence.
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'groq',
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  LLM_BASE_URL: process.env.LLM_BASE_URL || '',
  LLM_MODEL: process.env.LLM_MODEL || '',
  CRAWLER_DELAY_MS: int(process.env.CRAWLER_DELAY_MS, 2500),
  MAX_JOBS: int(process.env.MAX_JOBS_PER_RUN, 20),
  HEADFUL: bool(process.env.CRAWLER_HEADFUL, false),
  EMAIL_USER: process.env.EMAIL_USER || '',
  EMAIL_PASS: process.env.EMAIL_APP_PASSWORD || '',

  // Automatic daily crawl + job-description cache.
  AUTO_CRAWL: bool(process.env.AUTO_CRAWL, true),
  // Scheduled multi-source discovery (ATS APIs only — no browser/LLM needed,
  // so it's safe to leave on even where the agent crawl is off).
  AUTO_DISCOVER: bool(process.env.AUTO_DISCOVER, true),
  CRAWL_INTERVAL_HOURS: int(process.env.CRAWL_INTERVAL_HOURS, 24),
  JOB_CACHE_TTL_HOURS: int(process.env.JOB_CACHE_TTL_HOURS, 24),
  // Cached jobs not seen for this many days are pruned (0 disables pruning).
  JOB_CACHE_PRUNE_DAYS: int(process.env.JOB_CACHE_PRUNE_DAYS, 14),

  // Multi-source discovery (ATS public APIs). Cap per company board so a
  // discovery run stays bounded even across many large boards.
  MAX_JOBS_PER_COMPANY: int(process.env.MAX_JOBS_PER_COMPANY, 25),

  // Dashboard auth (JWT). Two tiers: the admin can always start a crawl; a
  // regular user can only start one when the last crawl was >24h ago.
  AUTH_USERNAME: process.env.AUTH_USERNAME || 'admin',
  AUTH_PASSWORD: process.env.AUTH_PASSWORD || 'changeme',
  USER_USERNAME: process.env.USER_USERNAME || 'user',
  USER_PASSWORD: process.env.USER_PASSWORD || 'user',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  JWT_EXPIRE_HOURS: int(process.env.JWT_EXPIRE_HOURS, 12),

  BASE_DIR,
  // Seed/config files ship with the app (read-only) — stay in the repo.
  PROFILE_PATH: path.join(BASE_DIR, 'data', 'profile.json'),
  COMPANIES_PATH: path.join(BASE_DIR, 'data', 'companies.json'),
  APPLICATIONS_PATH: path.join(BASE_DIR, 'data', 'applications.json'), // legacy — migrated into DB
  // Runtime-writable paths — override via env to point at a mounted volume
  // (e.g. Railway) so the DB, generated resumes, and state persist across deploys.
  DB_PATH: process.env.DB_PATH || path.join(BASE_DIR, 'data', 'applications.db'),
  CRAWL_STATE_PATH: process.env.CRAWL_STATE_PATH || path.join(BASE_DIR, 'data', 'crawl_state.json'),
  LLM_TOKEN_PATH: process.env.LLM_TOKEN_PATH || path.join(BASE_DIR, 'data', 'llm.json'),
  RESUMES_DIR: RESUMES_DIR,
  IMPORTS_DIR: process.env.IMPORTS_DIR || path.join(RESUMES_DIR, 'imported'),
};

module.exports = { config };
