'use strict';

class CrawlerService {
  constructor(sources) {
    if (!sources || sources.length === 0) {
      throw new Error('CrawlerService requires at least one JobSource');
    }
    this._sources = sources;
  }

  async search(role, location, pages = 2) {
    const seen = new Set();
    const results = [];

    for (const source of this._sources) {
      console.log(`\n[Crawler] ${source.sourceName} → "${role}" in "${location}"`);
      try {
        const jobs = await source.search(role, location, pages);
        let added = 0;
        for (const job of jobs) {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            results.push(job);
            added += 1;
          }
        }
        console.log(`[Crawler] ${source.sourceName}: +${added} unique jobs (${results.length} total)`);
      } catch (e) {
        console.log(`[Crawler] ${source.sourceName} error: ${e.message}`);
      }
    }

    return results;
  }
}

module.exports = { CrawlerService };
