'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('../config');

const COLUMNS = [
  'id', 'title', 'company', 'location', 'salary', 'source', 'apply_url',
  'resume_path', 'description', 'keywords_matched',
  'status', 'applied_at', 'updated_at', 'notes',
];

/**
 * SQLite-backed application tracker. Same public surface as the Python version,
 * so callers (web server, agent tools) need no changes.
 */
class TrackerService {
  constructor() {
    this._path = config.DB_PATH;
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    this._db = new Database(this._path);
    this._db.pragma('journal_mode = WAL'); // allow the crawl subprocess + server to share the file
    this._initDb();
    this._migrateFromJson();
  }

  // ── public API ────────────────────────────────────────────────────────────

  isApplied(jobId) {
    const row = this._db.prepare('SELECT 1 FROM applications WHERE id = ?').get(jobId);
    return row !== undefined;
  }

  save(job, resumePath, keywordsMatched = null, status = 'applied') {
    if (this.isApplied(job.id)) return;
    const now = new Date().toISOString();
    const entry = {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location || '',
      salary: job.salary || '',
      source: job.source || '',
      apply_url: job.apply_url,
      resume_path: resumePath,
      description: job.description || '',
      keywords_matched: keywordsMatched || [],
      status,
      applied_at: now,
      updated_at: now,
      notes: '',
    };
    this._insert(entry);
  }

  updateStatus(jobId, status, notes = '') {
    const now = new Date().toISOString();
    const info = this._db
      .prepare('UPDATE applications SET status = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(status, notes, now, jobId);
    if (info.changes === 0) return null;
    return this.getOne(jobId);
  }

  delete(jobId) {
    const info = this._db.prepare('DELETE FROM applications WHERE id = ?').run(jobId);
    return info.changes > 0;
  }

  getOne(jobId) {
    const row = this._db.prepare('SELECT * FROM applications WHERE id = ?').get(jobId);
    return row ? this._rowToDict(row) : null;
  }

  getAll(filterStatus = null) {
    let rows;
    if (filterStatus) {
      rows = this._db
        .prepare('SELECT * FROM applications WHERE status = ? ORDER BY applied_at')
        .all(filterStatus);
    } else {
      rows = this._db.prepare('SELECT * FROM applications ORDER BY applied_at').all();
    }
    return rows.map((r) => this._rowToDict(r));
  }

  /** Counts per status plus total, computed in SQL. */
  stats() {
    const out = { total: 0, applied: 0, not_applied: 0, interview: 0, offer: 0, rejected: 0 };
    const rows = this._db
      .prepare('SELECT status, COUNT(*) AS c FROM applications GROUP BY status')
      .all();
    for (const r of rows) {
      if (r.status in out) out[r.status] = r.c;
      out.total += r.c;
    }
    return out;
  }

  /** Filtered + sorted list — filtering happens in SQL, not in JS. */
  query({ status = null, source = null, search = null, sort = 'newest' } = {}) {
    const where = [];
    const params = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (source) {
      where.push('source = ?');
      params.push(source);
    }
    if (search) {
      where.push("(LOWER(title) LIKE ? OR LOWER(COALESCE(company, '')) LIKE ?)");
      const q = `%${String(search).toLowerCase()}%`;
      params.push(q, q);
    }
    const sql =
      'SELECT * FROM applications' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ` ORDER BY applied_at ${sort === 'newest' ? 'DESC' : 'ASC'}`;
    return this._db.prepare(sql).all(...params).map((r) => this._rowToDict(r));
  }

  // ── internals ─────────────────────────────────────────────────────────────

  _initDb() {
    this._db.exec(`CREATE TABLE IF NOT EXISTS applications (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      company          TEXT,
      location         TEXT,
      salary           TEXT DEFAULT '',
      source           TEXT,
      apply_url        TEXT,
      resume_path      TEXT,
      description      TEXT,
      keywords_matched TEXT,
      status           TEXT DEFAULT 'applied',
      applied_at       TEXT,
      updated_at       TEXT,
      notes            TEXT DEFAULT ''
    )`);
    // Evolve older DBs that predate a column (e.g. salary).
    const existing = new Set(this._db.prepare('PRAGMA table_info(applications)').all().map((r) => r.name));
    for (const col of COLUMNS) {
      if (!existing.has(col)) {
        this._db.exec(`ALTER TABLE applications ADD COLUMN ${col} TEXT DEFAULT ''`);
      }
    }
  }

  _insert(data) {
    const row = { ...data, keywords_matched: JSON.stringify(data.keywords_matched || []) };
    const placeholders = COLUMNS.map(() => '?').join(', ');
    this._db
      .prepare(`INSERT OR REPLACE INTO applications (${COLUMNS.join(', ')}) VALUES (${placeholders})`)
      .run(COLUMNS.map((col) => (row[col] !== undefined ? row[col] : null)));
  }

  _rowToDict(row) {
    const d = { ...row };
    try {
      d.keywords_matched = d.keywords_matched ? JSON.parse(d.keywords_matched) : [];
    } catch {
      d.keywords_matched = [];
    }
    return d;
  }

  _migrateFromJson() {
    // One-time import of a legacy applications.json into SQLite.
    const legacy = config.APPLICATIONS_PATH;
    if (!fs.existsSync(legacy)) return;
    const count = this._db.prepare('SELECT COUNT(*) AS c FROM applications').get().c;
    if (count > 0) return; // DB already populated; don't re-import
    let apps;
    try {
      apps = JSON.parse(fs.readFileSync(legacy, 'utf-8'));
    } catch {
      return;
    }
    for (const a of apps) {
      a.description = a.description || '';
      a.keywords_matched = a.keywords_matched || [];
      a.notes = a.notes || '';
      const picked = {};
      for (const col of COLUMNS) picked[col] = a[col];
      this._insert(picked);
    }
    // Keep the JSON as a backup but rename so we don't re-migrate.
    fs.renameSync(legacy, legacy.replace(/\.json$/, '.json.migrated'));
    console.log(`[Tracker] Migrated ${apps.length} applications from JSON -> SQLite`);
  }
}

module.exports = { TrackerService };
