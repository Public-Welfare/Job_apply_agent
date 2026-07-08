'use strict';

/**
 * Runs multi-source discovery (ATS public APIs — no browser or LLM) in-process
 * and exposes its observable state. Same single-instance assumption as
 * crawlRunner: the running flag and log live in this process's memory.
 */

const { config } = require('../config');
const { getMeta } = require('./metaService');
const { createJobState } = require('./jobState');
const { DiscoveryService } = require('./discoveryService');

const LAST_RUN_KEY = 'discovery_last_run';

const state = createJobState();
state.summary = null;
state.last_run = getMeta().get(LAST_RUN_KEY);

function isDue() {
  if (!state.last_run) return true;
  const t = Date.parse(state.last_run);
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) / (3600 * 1000) >= config.CRAWL_INTERVAL_HOURS;
}

async function runDiscovery(jobCache) {
  state.running = true;
  state.reset(['Starting discovery…']);
  state.summary = null;
  try {
    const summary = await new DiscoveryService(null, null, jobCache).run((line) => state.push(line));
    state.summary = summary;
    state.push(`Done — ${summary.total} jobs cached`);
    const pruned = jobCache.prune(config.JOB_CACHE_PRUNE_DAYS);
    if (pruned) state.push(`Pruned ${pruned} cached jobs unseen for ${config.JOB_CACHE_PRUNE_DAYS}+ days`);
  } catch (exc) {
    state.push(`Error: ${exc.message}`);
  } finally {
    state.running = false;
    state.last_run = new Date().toISOString();
    getMeta().set(LAST_RUN_KEY, state.last_run);
  }
}

module.exports = { state, runDiscovery, isDue };
