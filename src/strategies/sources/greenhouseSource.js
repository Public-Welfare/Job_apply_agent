'use strict';

const fs = require('fs');
const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');

const TAG_RE = /<[^>]+>/g;
const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of', 'jobs', 'job']);

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, "'").replace(/&mdash;/g, '—');
}

function stripHtml(html) {
  return decodeEntities((html || '').replace(TAG_RE, ' ')).replace(/\s+/g, ' ').trim();
}

function cap(token) {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

function loadTokens(key) {
  try {
    const data = JSON.parse(fs.readFileSync(config.COMPANIES_PATH, 'utf-8'));
    return Array.isArray(data[key]) ? data[key] : [];
  } catch {
    return [];
  }
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Greenhouse public boards API. Pulls the full job board for each configured
 * company token (data/companies.json → "greenhouse"), including descriptions in
 * one call via ?content=true. No auth, no bot wall.
 */
class GreenhouseSource extends JobSource {
  get sourceName() {
    return 'Greenhouse';
  }

  async search(role, location, pages = 1) { // eslint-disable-line no-unused-vars
    const tokens = loadTokens('greenhouse');
    const keywords = new Set(
      (role || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
    );
    const jobs = [];

    for (const token of tokens) {
      let data;
      try {
        data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
      } catch (e) {
        console.log(`  [Greenhouse] ${token} error: ${e.message}`);
        continue;
      }
      const list = (data && data.jobs) || [];
      let added = 0;
      for (const item of list) {
        const title = item.title;
        if (!title || !item.absolute_url) continue;
        const hint = (item.departments || []).map((d) => d.name).join(' ');
        const haystack = `${title} ${hint}`.toLowerCase();
        if (keywords.size && ![...keywords].some((kw) => haystack.includes(kw))) continue;

        const job = makeJob({
          id: `greenhouse_${token}_${item.id}`,
          title,
          company: item.company_name || cap(token),
          location: (item.location && item.location.name) || '',
          salary: '',
          apply_url: item.absolute_url,
          description: stripHtml(item.content).slice(0, 3000),
          source: this.sourceName,
        });
        job.hint = hint;
        jobs.push(job);
        if (++added >= config.MAX_JOBS_PER_COMPANY) break;
      }
      if (list.length) console.log(`  [Greenhouse] ${token}: +${added} jobs`);
    }

    console.log(`  [${this.sourceName}] ${jobs.length} jobs from ${tokens.length} boards`);
    return jobs;
  }
}

module.exports = { GreenhouseSource, loadTokens, fetchJson, cap, stripHtml };
