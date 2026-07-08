'use strict';

/**
 * Owns the background agent-crawl subprocess and its observable state.
 *
 * NOTE: run-state (running flag + log) lives in this process's memory — the
 * app assumes a single server instance. Scaling to multiple instances would
 * require moving this state (and the "already running" guard) into the DB.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const { config } = require('../config');
const { getMeta } = require('./metaService');
const { createJobState } = require('./jobState');

// Strip ANSI colour codes and carriage returns from crawl subprocess output.
const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJST]|\x1b\[[?][0-9]*[hl]|\r/g;

const LAST_RUN_KEY = 'crawl_last_run';

const state = createJobState();

function loadLastRun() {
  const meta = getMeta();
  const fromDb = meta.get(LAST_RUN_KEY);
  if (fromDb) return fromDb;
  // One-time import of the legacy crawl_state.json into the meta table.
  try {
    const data = JSON.parse(fs.readFileSync(config.CRAWL_STATE_PATH, 'utf-8'));
    if (data.last_run) {
      meta.set(LAST_RUN_KEY, data.last_run);
      fs.renameSync(config.CRAWL_STATE_PATH, config.CRAWL_STATE_PATH + '.migrated');
      return data.last_run;
    }
  } catch {
    /* no legacy state file */
  }
  return null;
}

state.last_run = loadLastRun();

function saveLastRun(ts) {
  getMeta().set(LAST_RUN_KEY, ts);
}

/** True when a run happened within CRAWL_INTERVAL_HOURS. */
function ranRecently(lastRun = state.last_run) {
  if (!lastRun) return false;
  const t = Date.parse(lastRun);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) / (3600 * 1000) < config.CRAWL_INTERVAL_HOURS;
}

function isCrawlDue() {
  return !ranRecently();
}

/** Spawn `node main.js crawl` and stream its output into the state log. */
function runCrawl(forceFresh = true, roles = []) {
  state.running = true;
  state.reset(roles.length ? [`Starting crawl for: ${roles.join(', ')}…`] : ['Starting crawl…']);
  return new Promise((resolve) => {
    const env = { ...process.env, CRAWL_FORCE_FRESH: forceFresh ? '1' : '0' };
    // Selected roles travel as a CLI flag; empty → main.js uses all profile roles.
    const args = ['main.js', 'crawl', `--roles=${JSON.stringify(roles || [])}`];
    let proc;
    try {
      proc = spawn(process.execPath, args, { cwd: config.BASE_DIR, env });
    } catch (exc) {
      state.push(`Error: ${exc.message}`);
      finish();
      return;
    }

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(ANSI_RE, '').trim();
        buffer = buffer.slice(idx + 1);
        if (line) state.push(line);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (exc) => {
      state.push(`Error: ${exc.message}`);
    });

    proc.on('close', (code) => {
      const tail = buffer.replace(ANSI_RE, '').trim();
      if (tail) state.push(tail);
      state.push(`Done — exit code ${code}`);
      finish();
    });

    function finish() {
      state.running = false;
      const now = new Date().toISOString();
      state.last_run = now;
      saveLastRun(now);
      resolve();
    }
  });
}

module.exports = { state, runCrawl, ranRecently, isCrawlDue };
