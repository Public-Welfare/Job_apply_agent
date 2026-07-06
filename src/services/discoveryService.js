'use strict';

const { GreenhouseSource } = require('../strategies/sources/greenhouseSource');
const { LeverSource } = require('../strategies/sources/leverSource');
const { AshbySource } = require('../strategies/sources/ashbySource');
const { WorkdaySource } = require('../strategies/sources/workdaySource');
const { RemoteOKSource } = require('../strategies/sources/remoteokSource');
const { JobClassifier } = require('./jobClassifier');
const { JobCacheService } = require('./jobCacheService');

/**
 * Multi-source discovery: fan out across every job source, classify each job
 * into JobType categories, and cache the lot. This powers the dashboard's
 * job-type dropdown — the user filters the cache by type instead of triggering
 * a live crawl. Runs in-process (no LLM, no browser) so it's quick to trigger
 * from an API call.
 *
 * Indeed is intentionally excluded here (Playwright + bot-limited); it stays
 * available to the resume-tailoring agent crawl.
 */
class DiscoveryService {
  constructor(sources = null, classifier = null, cache = null) {
    this._sources = sources || [
      new GreenhouseSource(),
      new LeverSource(),
      new AshbySource(),
      new WorkdaySource(),
      new RemoteOKSource(),
    ];
    this._classifier = classifier || new JobClassifier();
    this._cache = cache || new JobCacheService();
  }

  /**
   * @param {(line:string)=>void} [onLog] progress callback (per line).
   * @returns {Promise<{total:number, perSource:Object, byType:Object}>}
   */
  async run(onLog = null) {
    const log = (line) => {
      if (onLog) onLog(line);
      else console.log(line);
    };

    const perSource = {};
    const byType = {};
    let total = 0;

    for (const source of this._sources) {
      log(`Fetching from ${source.sourceName}…`);
      let jobs = [];
      try {
        // role='' → no keyword filter → take a broad sample from each board.
        jobs = await source.search('', 'Remote', 1);
      } catch (e) {
        log(`  ${source.sourceName} failed: ${e.message}`);
        perSource[source.sourceName] = 0;
        continue;
      }

      this._classifier.classifyAll(jobs);
      this._cache.rememberMany(jobs, 'discover');

      for (const job of jobs) {
        for (const c of job.categories) byType[c] = (byType[c] || 0) + 1;
      }
      perSource[source.sourceName] = jobs.length;
      total += jobs.length;
      log(`  ${source.sourceName}: ${jobs.length} jobs classified & cached`);
    }

    log(`Discovery complete — ${total} jobs across ${this._sources.length} sources.`);
    return { total, perSource, byType };
  }
}

module.exports = { DiscoveryService };
