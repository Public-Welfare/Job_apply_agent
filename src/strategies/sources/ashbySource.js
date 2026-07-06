'use strict';

const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');
const { loadTokens, fetchJson, cap } = require('./greenhouseSource');

const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of', 'jobs', 'job']);

/**
 * Ashby public job-board API (api.ashbyhq.com/posting-api/job-board/{company}).
 * Returns JSON with plain-text descriptions and department/team hints. No auth.
 */
class AshbySource extends JobSource {
  get sourceName() {
    return 'Ashby';
  }

  async search(role, location, pages = 1) { // eslint-disable-line no-unused-vars
    const tokens = loadTokens('ashby');
    const keywords = new Set(
      (role || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
    );
    const jobs = [];

    for (const token of tokens) {
      let data;
      try {
        data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      } catch (e) {
        console.log(`  [Ashby] ${token} error: ${e.message}`);
        continue;
      }
      const list = (data && data.jobs) || [];
      let added = 0;
      for (const item of list) {
        const title = item.title;
        const url = item.jobUrl || item.applyUrl;
        if (!title || !url) continue;
        const hint = `${item.department || ''} ${item.team || ''}`;
        const haystack = `${title} ${hint}`.toLowerCase();
        if (keywords.size && ![...keywords].some((kw) => haystack.includes(kw))) continue;

        const job = makeJob({
          id: `ashby_${token}_${item.id}`,
          title,
          company: cap(token),
          location: item.location || (item.isRemote ? 'Remote' : ''),
          salary: '',
          apply_url: url,
          description: (item.descriptionPlain || '').slice(0, 3000),
          source: this.sourceName,
        });
        job.hint = hint;
        jobs.push(job);
        if (++added >= config.MAX_JOBS_PER_COMPANY) break;
      }
      if (list.length) console.log(`  [Ashby] ${token}: +${added} jobs`);
    }

    console.log(`  [${this.sourceName}] ${jobs.length} jobs from ${tokens.length} boards`);
    return jobs;
  }
}

module.exports = { AshbySource };
