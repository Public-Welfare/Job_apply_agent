'use strict';

const { chromium } = require('playwright');
const { JobSource } = require('../../interfaces/jobSource');
const { makeJob } = require('../../models');
const { config } = require('../../config');

const TITLE_SELECTORS = [
  "h2 a span[title]",
  "h2.jobTitle a span",
  "[class*='jobTitle'] a span",
  "h2 a span",
  "h2 a",
];
// NOTE: company & location live in the result ROW (.job_seen_beacon / .cardOutline),
// NOT inside the [data-jk] card element — selectors must be scoped to the row.
const COMPANY_SELECTORS = [
  "[data-testid='company-name']",
  "span[data-testid='company-name']",
  "[class*='companyName']",
];
const LOCATION_SELECTORS = [
  "[data-testid='text-location']",
  "[data-testid='company-location']",
  "[class*='companyLocation']",
];
const SALARY_SELECTORS = [
  "[data-testid='attribute_snippet_testid']",
  ".salary-snippet-container",
  "[class*='salary-snippet']",
  "[class*='salaryOnly']",
  "[class*='estimated-salary']",
];
const DESC_SELECTORS = [
  "#jobDescriptionText",
  ".jobsearch-jobDescriptionText",
  "[class*='JobDescription']",
  "[class*='jobdescription']",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jitter() {
  await sleep(config.CRAWLER_DELAY_MS + Math.random() * 1500);
}

class IndeedSource extends JobSource {
  get sourceName() {
    return 'Indeed India';
  }

  async search(role, location, pages = 2) {
    const jobs = [];

    const browser = await chromium.launch({ headless: !config.HEADFUL });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
    });

    try {
      for (let pageNum = 0; pageNum < pages; pageNum++) {
        const listings = await this._scrapePage(context, role, location, pageNum);
        console.log(`  [${this.sourceName}] Page ${pageNum + 1}: ${listings.length} listings`);

        for (const item of listings) {
          item.description = await this._fetchDescription(context, item.apply_url);
          jobs.push(makeJob(item));
          await jitter();
          if (jobs.length >= config.MAX_JOBS) break;
        }

        if (jobs.length >= config.MAX_JOBS) break;
        await jitter();
      }
    } finally {
      await browser.close();
    }

    return jobs;
  }

  async _scrapePage(context, role, location, pageNum) {
    const start = pageNum * 10;
    const url =
      `https://in.indeed.com/jobs` +
      `?q=${role.replace(/ /g, '+')}&l=${location.replace(/ /g, '+')}` +
      `&start=${start}&sort=date`;

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const title = await page.title();
      if (['captcha', 'verify', 'robot', 'unusual'].some((w) => title.toLowerCase().includes(w))) {
        console.log(`  [${this.sourceName}] Blocked — page title: '${title}'`);
        return [];
      }

      try {
        await page.waitForSelector('[data-jk]', { timeout: 10000 });
      } catch {
        console.log(`  [${this.sourceName}] No job cards found. Title: '${title}'`);
        return [];
      }

      const listings = await page.evaluate(
        ([titleSels, companySels, locationSels, salarySels]) => {
          function first(root, sels) {
            for (const sel of sels) {
              const el = root.querySelector(sel);
              if (el && el.textContent && el.textContent.trim()) return el;
            }
            return null;
          }
          // Extract only the clean money pattern — snippet containers can
          // also hold job type ("Full-time") or injected <style> CSS text.
          const PAY = /[₹$£]\s?[\d,]+(?:\.\d+)?(?:\s*(?:[-–]|to)\s*[₹$£]?\s?[\d,]+(?:\.\d+)?)?(?:\s*(?:a|per)\s+(?:year|month|week|day|hour|annum))?|[\d.]+\s*-?\s*[\d.]*\s*LPA/i;
          function findSalary(root, sels) {
            for (const sel of sels) {
              for (const el of root.querySelectorAll(sel)) {
                if (el.querySelector('style')) continue; // skip CSS-bearing nodes
                const t = el.textContent || '';
                const m = t.match(PAY);
                if (m) return m[0].trim();
              }
            }
            return '';
          }
          return [...document.querySelectorAll('[data-jk]')].reduce((acc, card) => {
            const id = card.getAttribute('data-jk');
            if (!id) return acc;
            // Climb to the full result row — company & location are siblings
            // of the card, not descendants of [data-jk].
            const row =
              card.closest('.job_seen_beacon') ||
              card.closest('.cardOutline') ||
              card.closest('.slider_item') ||
              card.parentElement ||
              card;
            const titleEl = first(row, titleSels);
            const title =
              (titleEl && titleEl.getAttribute('title')) ||
              (titleEl && titleEl.textContent && titleEl.textContent.trim()) ||
              '';
            if (!title) return acc;
            acc.push({
              id,
              title,
              company: (first(row, companySels)?.textContent || '').trim(),
              location: (first(row, locationSels)?.textContent || '').trim(),
              salary: findSalary(row, salarySels),
            });
            return acc;
          }, []);
        },
        [TITLE_SELECTORS, COMPANY_SELECTORS, LOCATION_SELECTORS, SALARY_SELECTORS]
      );

      return listings.map((item) => ({
        ...item,
        apply_url: `https://in.indeed.com/viewjob?jk=${item.id}`,
        source: this.sourceName,
      }));
    } finally {
      await page.close();
    }
  }

  async _fetchDescription(context, url) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      try {
        await page.waitForSelector(DESC_SELECTORS.join(', '), { timeout: 8000 });
      } catch {
        // description may load late or differ; read whatever is present
      }

      return await page.evaluate((sels) => {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
        }
        return '';
      }, DESC_SELECTORS);
    } catch {
      return '';
    } finally {
      await page.close();
    }
  }
}

module.exports = { IndeedSource };
