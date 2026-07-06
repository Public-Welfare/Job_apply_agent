'use strict';

const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');
const { loadTokens, cap } = require('./greenhouseSource');

/**
 * Workday-hosted career sites (myworkdayjobs.com). Unlike the other ATS APIs
 * this is a per-tenant JSON POST to the CXS endpoint:
 *
 *   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *   body: { appliedFacets:{}, limit, offset, searchText }
 *
 * `searchText` is applied server-side, so a role query filters at the source.
 * Descriptions need a second per-job call, so we skip them here (classification
 * runs on the title) to keep discovery fast. Each entry in data/companies.json
 * → "workday" is an object: { host, tenant, site, name? }.
 */
class WorkdaySource extends JobSource {
  get sourceName() {
    return 'Workday';
  }

  async search(role, location, pages = 1) { // eslint-disable-line no-unused-vars
    const entries = loadTokens('workday');
    const jobs = [];

    for (const e of entries) {
      if (!e || !e.host || !e.tenant || !e.site) continue;
      let data;
      try {
        const resp = await fetch(`https://${e.host}/wday/cxs/${e.tenant}/${e.site}/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          body: JSON.stringify({
            appliedFacets: {},
            // Workday caps page size at 20 — asking for more returns HTTP 400.
            limit: Math.min(config.MAX_JOBS_PER_COMPANY, 20),
            offset: 0,
            searchText: role || '',
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        data = await resp.json();
      } catch (err) {
        console.log(`  [Workday] ${e.tenant} error: ${err.message}`);
        continue;
      }

      const list = (data && data.jobPostings) || [];
      let added = 0;
      for (const item of list) {
        const ext = item.externalPath;
        if (!item.title || !ext) continue;
        const slug = ext.replace(/[^a-zA-Z0-9]/g, '').slice(-40);
        const job = makeJob({
          id: `workday_${e.tenant}_${slug}`,
          title: item.title,
          company: e.name || cap(e.tenant),
          location: item.locationsText || '',
          salary: '',
          apply_url: `https://${e.host}/${e.site}${ext}`,
          description: '',
          source: this.sourceName,
        });
        job.hint = '';
        jobs.push(job);
        if (++added >= config.MAX_JOBS_PER_COMPANY) break;
      }
      if (list.length) console.log(`  [Workday] ${e.tenant}: +${added} jobs`);
    }

    console.log(`  [${this.sourceName}] ${jobs.length} jobs from ${entries.length} tenants`);
    return jobs;
  }
}

module.exports = { WorkdaySource };
