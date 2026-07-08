'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('../config');

/**
 * Tiny key/value store in the shared SQLite DB. Replaces the loose JSON state
 * files (crawl_state.json, llm.json) so all runtime state lives in one place —
 * and on one mounted volume in production.
 */
class MetaService {
  constructor() {
    fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
    this._db = new Database(config.DB_PATH);
    this._db.pragma('journal_mode = WAL');
    this._db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  }

  get(key) {
    const row = this._db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  set(key, value) {
    this._db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  getJson(key) {
    try {
      const v = this.get(key);
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  }

  setJson(key, obj) {
    this.set(key, JSON.stringify(obj));
  }

  delete(key) {
    this._db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }
}

let instance = null;
/** Lazy singleton — the CLI and the server both use this without wiring. */
function getMeta() {
  if (!instance) instance = new MetaService();
  return instance;
}

module.exports = { MetaService, getMeta };
