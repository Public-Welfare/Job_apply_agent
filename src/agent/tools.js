'use strict';

const { config } = require('../config');
const { CrawlerService } = require('../services/crawlerService');
const { JobCacheService } = require('../services/jobCacheService');
const { ResumeService } = require('../services/resumeService');
const { TrackerService } = require('../services/trackerService');
const { RoleService } = require('../services/roleService');
const { IndeedSource } = require('../strategies/sources/indeedSource');
const { RemoteOKSource } = require('../strategies/sources/remoteokSource');
const { OllamaCustomizer } = require('../strategies/customizers/ollamaCustomizer');
const { filterByPreferences } = require('../utils/jobFilter');
const { makeJob, loadProfile } = require('../models');

// Compose services with strategies via Dependency Injection.
// Naukri is Akamai-blocked from headless browsers, so RemoteOK (API-based)
// is wired in as the second source — both satisfy the JobSource interface.
const crawler = new CrawlerService([new IndeedSource(), new RemoteOKSource()]);
const resumeService = new ResumeService(new OllamaCustomizer());
const tracker = new TrackerService();
const cache = new JobCacheService();
const roles = new RoleService();

// The daily scheduler launches the crawl with CRAWL_FORCE_FRESH=1 so it always
// refreshes the cache from the network. A user-initiated search leaves it unset
// and may be served straight from the cache (no network) when it's still fresh.
const FORCE_FRESH = process.env.CRAWL_FORCE_FRESH === '1';

// Cache full job records by id so the LLM only needs to pass back the id.
const jobCache = {};

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_jobs',
      description: 'Search Indeed India and Naukri for job listings',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          location: { type: 'string' },
          pages: { type: 'number', description: 'Pages per source (default 2)' },
        },
        required: ['role', 'location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_job',
      description: 'Filter, customize resume for, and track a specific job',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          apply_url: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['id', 'title', 'company', 'apply_url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_applications',
      description: 'Return all tracked job applications',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'applied | interview | rejected | offer' },
        },
      },
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'search_jobs': {
      const role = args.role;
      let servedFromCache = false;

      // Track this role in the DB (RoleService). Whether it's "due" for a real
      // crawl is an explicit per-role lookup on its last_crawled_at.
      roles.upsert(role, args.location || '');
      const due = roles.isDue(role, args.location || '');

      // Cache-first: if this role isn't due (crawled recently) and we have fresh
      // cached results, reuse those instead of hitting the network. The daily
      // scheduler sets CRAWL_FORCE_FRESH so it always bypasses this and refreshes.
      let jobs = [];
      if (!FORCE_FRESH && !due && config.JOB_CACHE_TTL_HOURS > 0) {
        jobs = cache.freshJobs(role, config.JOB_CACHE_TTL_HOURS);
        servedFromCache = jobs.length > 0;
      }

      if (jobs.length === 0) {
        jobs = await crawler.search(role, args.location, parseInt(args.pages ?? 2, 10));
        // A real crawl happened → stamp the role's last_crawled_at.
        roles.markCrawled(role, args.location || '');
      }

      // Remember every result so popular descriptions rank up and future searches
      // can be served without crawling.
      cache.rememberMany(jobs, role);

      // Cache the full record by id, then strip the description from the search
      // result so the LLM context stays small.
      for (const j of jobs) jobCache[j.id] = { ...j };

      return {
        found: jobs.length,
        from_cache: servedFromCache,
        jobs: jobs.map((j) => {
          const { description, ...rest } = j; // eslint-disable-line no-unused-vars
          return rest;
        }),
      };
    }

    case 'process_job': {
      const jobId = args.id;
      if (!jobId) return { skipped: true, reason: 'Missing job id' };

      // Prefer the cached crawl record (authoritative for source/company/
      // location/description); overlay any non-empty fields the LLM sent.
      const cached = jobCache[jobId] || {};
      const overlay = {};
      for (const [k, v] of Object.entries(args)) if (v) overlay[k] = v;
      const data = { ...cached, ...overlay };

      if (!data.title || !data.apply_url) {
        return { skipped: true, reason: 'Incomplete job data — skipped' };
      }

      const profile = loadProfile();
      const job = makeJob({
        id: jobId,
        title: data.title,
        company: data.company || '',
        location: data.location || '',
        salary: data.salary || '',
        apply_url: data.apply_url,
        description: data.description || '',
        source: data.source || '',
      });

      if (tracker.isApplied(job.id)) {
        return { skipped: true, reason: 'Already applied to this job' };
      }

      const [passed, reason] = filterByPreferences(job, profile.preferences);
      if (!passed) return { skipped: true, reason };

      try {
        const [customized, pdfPath] = await resumeService.buildForJob(profile, job);
        // The agent finds & tailors the role but doesn't submit it —
        // save as "not_applied" so the user reviews before applying.
        tracker.save(job, pdfPath, customized.keywords_matched, 'not_applied');
        return {
          processed: true,
          keywords_matched: customized.keywords_matched,
          resume_path: pdfPath,
          apply_url: job.apply_url,
        };
      } catch (e) {
        return { error: e.message, job_id: job.id };
      }
    }

    case 'get_applications': {
      const apps = tracker.getAll(args.status);
      return { total: apps.length, applications: apps };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOL_DEFINITIONS, handleToolCall };
