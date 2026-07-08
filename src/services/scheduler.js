'use strict';

/**
 * Background scheduler: wakes every 15 minutes and, when the last run is older
 * than CRAWL_INTERVAL_HOURS, kicks the agent crawl (AUTO_CRAWL) and/or the
 * multi-source discovery (AUTO_DISCOVER). Last-run times persist in the meta
 * table, so a server restart does not trigger an immediate re-run.
 */

const { config } = require('../config');
const crawl = require('./crawlRunner');
const discovery = require('./discoveryRunner');

const CHECK_EVERY_MS = 15 * 60 * 1000;

async function tick(jobCache) {
  try {
    if (config.AUTO_CRAWL && !crawl.state.running && crawl.isCrawlDue()) {
      await crawl.runCrawl(true); // scheduled runs always bypass the cache
    }
  } catch (exc) {
    crawl.state.push(`Scheduler error: ${exc.message}`);
  }
  try {
    if (config.AUTO_DISCOVER && !discovery.state.running && discovery.isDue()) {
      await discovery.runDiscovery(jobCache);
    }
  } catch (exc) {
    discovery.state.push(`Scheduler error: ${exc.message}`);
  }
}

function startScheduler(jobCache) {
  if (!config.AUTO_CRAWL && !config.AUTO_DISCOVER) return;
  const loop = () => {
    tick(jobCache).finally(() => {
      const t = setTimeout(loop, CHECK_EVERY_MS);
      t.unref(); // don't keep the process alive purely for the scheduler
    });
  };
  loop();
}

module.exports = { startScheduler };
