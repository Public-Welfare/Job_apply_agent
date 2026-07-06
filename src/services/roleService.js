'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('../config');
const { loadProfile } = require('../models');

const now = () => new Date().toISOString();

/**
 * The person's target job roles as first-class DB rows (the UML `RoleService`).
 * Each role tracks when it was last crawled, so "already crawled recently → serve
 * from cache instead of re-crawling" becomes an explicit lookup (`isDue`) rather
 * than an inference. Seeded from data/profile.json on first use; editable via the
 * API. Shares applications.db.
 */
class RoleService {
  constructor() {
    this._path = config.DB_PATH;
    fs.mkdirSync(path.dirname(this._path), { recursive: true });
    this._db = new Database(this._path);
    this._db.pragma('journal_mode = WAL');
    this._initDb();
    if (this._count() === 0) this.seedFromProfile();
  }

  // ── write ───────────────────────────────────────────────────────────────

  /** Insert a role if new (unique by role text); returns the row. */
  upsert(role, location = '') {
    const name = String(role || '').trim();
    if (!name) return null;
    const existing = this._db.prepare('SELECT * FROM roles WHERE role = ?').get(name);
    if (existing) {
      if (location && location !== existing.location) {
        this._db.prepare('UPDATE roles SET location = ? WHERE id = ?').run(location, existing.id);
      }
      return this.get(existing.id);
    }
    const info = this._db
      .prepare('INSERT INTO roles (role, location, last_crawled_at, times_crawled, active, created_at) VALUES (?, ?, NULL, 0, 1, ?)')
      .run(name, location || '', now());
    return this.get(info.lastInsertRowid);
  }

  /** Stamp a role as just-crawled (creating it if needed). */
  markCrawled(role, location = '') {
    const row = this.upsert(role, location);
    if (!row) return null;
    this._db
      .prepare('UPDATE roles SET last_crawled_at = ?, times_crawled = times_crawled + 1 WHERE id = ?')
      .run(now(), row.id);
    return this.get(row.id);
  }

  setActive(id, active) {
    this._db.prepare('UPDATE roles SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    return this.get(id);
  }

  remove(id) {
    return this._db.prepare('DELETE FROM roles WHERE id = ?').run(id).changes > 0;
  }

  seedFromProfile() {
    let roles = [];
    let firstLoc = '';
    try {
      const profile = loadProfile();
      roles = profile.preferences.roles || [];
      firstLoc = (profile.preferences.locations || [])[0] || '';
    } catch {
      return;
    }
    const insert = this._db.prepare(
      'INSERT OR IGNORE INTO roles (role, location, last_crawled_at, times_crawled, active, created_at) VALUES (?, ?, NULL, 0, 1, ?)'
    );
    const ts = now();
    const tx = this._db.transaction((list) => {
      for (const r of list) if (String(r).trim()) insert.run(String(r).trim(), firstLoc, ts);
    });
    tx(roles);
  }

  // ── read ────────────────────────────────────────────────────────────────

  get(id) {
    const row = this._db.prepare('SELECT * FROM roles WHERE id = ?').get(id);
    return row ? this._decorate(row) : null;
  }

  all() {
    return this._db
      .prepare('SELECT * FROM roles ORDER BY active DESC, role')
      .all()
      .map((r) => this._decorate(r));
  }

  /**
   * Is this role due for a crawl? True when never crawled or older than
   * `intervalHours` (defaults to the configured crawl interval).
   */
  isDue(role, location = '', intervalHours = config.CRAWL_INTERVAL_HOURS) {
    const row = this._db.prepare('SELECT * FROM roles WHERE role = ?').get(String(role || '').trim());
    if (!row || !row.last_crawled_at) return true;
    const t = Date.parse(row.last_crawled_at);
    if (Number.isNaN(t)) return true;
    return (Date.now() - t) / (3600 * 1000) >= intervalHours;
  }

  // ── internals ────────────────────────────────────────────────────────────

  _decorate(row) {
    let nextDue = null;
    if (row.last_crawled_at) {
      const t = Date.parse(row.last_crawled_at);
      if (!Number.isNaN(t)) nextDue = new Date(t + config.CRAWL_INTERVAL_HOURS * 3600 * 1000).toISOString();
    }
    return {
      ...row,
      active: !!row.active,
      due: this.isDue(row.role, row.location),
      next_due: nextDue,
    };
  }

  _count() {
    return this._db.prepare('SELECT COUNT(*) AS c FROM roles').get().c;
  }

  _initDb() {
    this._db.exec(`CREATE TABLE IF NOT EXISTS roles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      role            TEXT NOT NULL UNIQUE,
      location        TEXT DEFAULT '',
      last_crawled_at TEXT,
      times_crawled   INTEGER DEFAULT 0,
      active          INTEGER DEFAULT 1,
      created_at      TEXT
    )`);
  }
}

module.exports = { RoleService };
