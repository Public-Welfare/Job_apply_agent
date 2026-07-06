'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('../config');
const { makeJob } = require('../models');

const COLUMNS = [
  'id', 'title', 'company', 'location', 'salary', 'source', 'apply_url',
  'description', 'role_query', 'hits', 'first_cached_at', 'last_seen_at', 'categories',
];

const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of', 'jobs', 'job']);

const now = () => new Date().toISOString();

function keywords(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}

/**
 * SQLite-backed cache of crawled job descriptions with a hit counter.
 * Gives popularity ranking (popular) and freshness lookup (freshJobs) so
 * user searches can be served without a live crawl. Shares applications.db.
 */
class JobCacheService {
  constructor() {
    this._path = config.DB_PATH;
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    this._db = new Database(this._path);
    this._db.pragma('journal_mode = WAL');
    this._initDb();
  }

  // ── write ───────────────────────────────────────────────────────────────

  remember(job, roleQuery = '') {
    const ts = now();
    const cats = JSON.stringify(Array.isArray(job.categories) ? job.categories : []);
    const existing = this._db
      .prepare('SELECT hits, description, categories FROM job_cache WHERE id = ?')
      .get(job.id);
    if (existing) {
      // Keep the longer description (detail pages sometimes come back empty)
      // and refresh categories when the incoming job carries them.
      const newDesc = job.description || '';
      const oldDesc = existing.description || '';
      const desc = newDesc.length > oldDesc.length ? newDesc : oldDesc;
      const catsToStore = (job.categories && job.categories.length) ? cats : (existing.categories || '[]');
      this._db
        .prepare(
          'UPDATE job_cache SET hits = hits + 1, last_seen_at = ?, description = ?, role_query = ?, categories = ? WHERE id = ?'
        )
        .run(ts, desc, roleQuery || '', catsToStore, job.id);
    } else {
      this._db
        .prepare(
          `INSERT INTO job_cache (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`
        )
        .run(
          job.id, job.title, job.company, job.location, job.salary,
          job.source, job.apply_url, job.description, roleQuery || '',
          1, ts, ts, cats
        );
    }
  }

  rememberMany(jobs, roleQuery = '') {
    for (const job of jobs) this.remember(job, roleQuery);
  }

  recordUse(jobId) {
    this._db
      .prepare('UPDATE job_cache SET hits = hits + 1, last_seen_at = ? WHERE id = ?')
      .run(now(), jobId);
  }

  // ── read ────────────────────────────────────────────────────────────────

  popular(limit = 20, search = null) {
    const rows = this._db
      .prepare('SELECT * FROM job_cache ORDER BY hits DESC, last_seen_at DESC')
      .all();
    let out = rows.map((r) => ({ ...r }));
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (j) => j.title.toLowerCase().includes(q) || (j.company || '').toLowerCase().includes(q)
      );
    }
    return out.slice(0, limit);
  }

  get(jobId) {
    const row = this._db.prepare('SELECT * FROM job_cache WHERE id = ?').get(jobId);
    return row ? { ...row } : null;
  }

  freshJobs(role, maxAgeHours, limit = 50) {
    if (maxAgeHours <= 0) return [];
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
    const wanted = keywords(role);
    const rows = this._db
      .prepare('SELECT * FROM job_cache WHERE last_seen_at >= ? ORDER BY hits DESC')
      .all(cutoff);
    const jobs = [];
    for (const r of rows) {
      const haystack = `${r.title} ${r.role_query}`.toLowerCase();
      if (wanted.size && ![...wanted].some((kw) => haystack.includes(kw))) continue;
      jobs.push(
        makeJob({
          id: r.id, title: r.title, company: r.company, location: r.location,
          salary: r.salary, apply_url: r.apply_url, description: r.description, source: r.source,
        })
      );
      if (jobs.length >= limit) break;
    }
    return jobs;
  }

  stats() {
    const total = this._db.prepare('SELECT COUNT(*) AS c FROM job_cache').get().c;
    const hits = this._db.prepare('SELECT COALESCE(SUM(hits), 0) AS s FROM job_cache').get().s;
    const newest = this._db.prepare('SELECT MAX(last_seen_at) AS m FROM job_cache').get().m;
    return { cached: total, total_hits: hits, last_cached_at: newest };
  }

  // ── job-type (category) queries ───────────────────────────────────────────

  /** All cached rows with `categories` parsed into an array. */
  all() {
    return this._db
      .prepare('SELECT * FROM job_cache ORDER BY last_seen_at DESC, hits DESC')
      .all()
      .map((r) => this._withCategories(r));
  }

  /**
   * Cached jobs whose categories intersect `types` (OR semantics). When `types`
   * is empty, returns everything. Filtered in JS since categories are JSON and
   * the cache is small (hundreds of rows).
   */
  byTypes(types = [], { search = null, limit = 500 } = {}) {
    const want = new Set(types || []);
    let out = this.all();
    if (want.size) out = out.filter((j) => j.categories.some((c) => want.has(c)));
    if (search) {
      const q = search.toLowerCase();
      out = out.filter(
        (j) => j.title.toLowerCase().includes(q) || (j.company || '').toLowerCase().includes(q)
      );
    }
    return out.slice(0, limit);
  }

  /** Count of cached jobs per category id (a job counts once per tag it holds). */
  typeCounts() {
    const counts = {};
    for (const j of this.all()) {
      for (const c of j.categories) counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }

  _withCategories(row) {
    let categories = [];
    try {
      categories = row.categories ? JSON.parse(row.categories) : [];
    } catch {
      categories = [];
    }
    return { ...row, categories };
  }

  // ── internals ────────────────────────────────────────────────────────────

  _initDb() {
    this._db.exec(`CREATE TABLE IF NOT EXISTS job_cache (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      company         TEXT,
      location        TEXT,
      salary          TEXT DEFAULT '',
      source          TEXT,
      apply_url       TEXT,
      description     TEXT,
      role_query      TEXT,
      hits            INTEGER DEFAULT 1,
      first_cached_at TEXT,
      last_seen_at    TEXT,
      categories      TEXT DEFAULT '[]'
    )`);
    // Evolve older caches that predate the categories column.
    const cols = this._db.prepare('PRAGMA table_info(job_cache)').all().map((c) => c.name);
    if (!cols.includes('categories')) {
      this._db.exec("ALTER TABLE job_cache ADD COLUMN categories TEXT DEFAULT '[]'");
    }
    this._db.exec('CREATE INDEX IF NOT EXISTS idx_job_cache_hits ON job_cache(hits DESC)');
    this._db.exec('CREATE INDEX IF NOT EXISTS idx_job_cache_seen ON job_cache(last_seen_at)');
  }
}

module.exports = { JobCacheService };
