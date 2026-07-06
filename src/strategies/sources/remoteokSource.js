'use strict';

const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');

const API_URL = 'https://remoteok.com/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const TAG_RE = /<[^>]+>/g;
const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html) {
  const text = (html || '').replace(TAG_RE, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * API-based job source — same JobSource contract as the Playwright scrapers,
 * but fetches clean JSON from RemoteOK's public feed.
 */
class RemoteOKSource extends JobSource {
  get sourceName() {
    return 'RemoteOK';
  }

  async search(role, location, pages = 2) { // eslint-disable-line no-unused-vars
    const raw = await this._fetch();
    if (!raw || raw.length === 0) return [];

    const keywords = new Set(
      role.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
    );

    const jobs = [];
    for (const item of raw) {
      const position = item.position || item.title;
      if (!position) continue; // first feed element is legal metadata

      const haystack = `${position} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (keywords.size && ![...keywords].some((kw) => haystack.includes(kw))) continue;

      jobs.push(
        makeJob({
          id: `remoteok_${item.id || item.slug}`,
          title: position,
          company: item.company || '',
          location: item.location || 'Remote',
          salary: this._formatSalary(item),
          apply_url: item.url || item.apply_url || '',
          description: stripHtml(item.description || '').slice(0, 3000),
          source: this.sourceName,
        })
      );
      if (jobs.length >= config.MAX_JOBS) break;
    }

    console.log(`  [${this.sourceName}] ${jobs.length} matching jobs`);
    return jobs;
  }

  _formatSalary(item) {
    const lo = item.salary_min;
    const hi = item.salary_max;
    const k = (v) => (v && v >= 1000 ? `$${Math.floor(v / 1000)}k` : `$${v}`);
    if (lo && hi) return `${k(lo)} – ${k(hi)}`;
    if (lo) return `from ${k(lo)}`;
    if (hi) return `up to ${k(hi)}`;
    return '';
  }

  async _fetch() {
    // Retry a couple of times — RemoteOK occasionally drops the TLS handshake.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const resp = await fetch(API_URL, {
            headers: { 'User-Agent': UA },
            signal: controller.signal,
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return await resp.json();
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        if (attempt === 3) {
          console.log(`  [RemoteOK] fetch error after ${attempt} attempts: ${e.message}`);
          return [];
        }
        console.log(`  [RemoteOK] attempt ${attempt} failed (${e.message}); retrying…`);
        await sleep(attempt * 1000);
      }
    }
    return [];
  }
}

module.exports = { RemoteOKSource };
