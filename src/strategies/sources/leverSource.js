'use strict';

const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');
const { loadTokens, fetchJson, cap } = require('./greenhouseSource');

const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of', 'jobs', 'job']);

/**
 * Lever public postings API (api.lever.co/v0/postings/{company}?mode=json).
 * Returns clean JSON with a plain-text description. No auth.
 */
class LeverSource extends JobSource {
  get sourceName() {
    return 'Lever';
  }

  async search(role, location, pages = 1) { // eslint-disable-line no-unused-vars
    const tokens = loadTokens('lever');
    const keywords = new Set(
      (role || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
    );
    const jobs = [];

    for (const token of tokens) {
      let list;
      try {
        list = await fetchJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      } catch (e) {
        console.log(`  [Lever] ${token} error: ${e.message}`);
        continue;
      }
      if (!Array.isArray(list)) continue;
      let added = 0;
      for (const item of list) {
        const title = item.text;
        const url = item.hostedUrl || item.applyUrl;
        if (!title || !url) continue;
        const cats = item.categories || {};
        const hint = `${cats.team || ''} ${cats.department || ''}`;
        const haystack = `${title} ${hint}`.toLowerCase();
        if (keywords.size && ![...keywords].some((kw) => haystack.includes(kw))) continue;

        const job = makeJob({
          id: `lever_${token}_${item.id}`,
          title,
          company: cap(token),
          location: cats.location || item.workplaceType || '',
          salary: '',
          apply_url: url,
          description: (item.descriptionPlain || '').slice(0, 3000),
          source: this.sourceName,
        });
        job.hint = hint;
        jobs.push(job);
        if (++added >= config.MAX_JOBS_PER_COMPANY) break;
      }
      if (list.length) console.log(`  [Lever] ${token}: +${added} jobs`);
    }

    console.log(`  [${this.sourceName}] ${jobs.length} jobs from ${tokens.length} boards`);
    return jobs;
  }
}

module.exports = { LeverSource };
