'use strict';

const STOP = new Set(['and', 'or', 'for', 'the', 'a', 'an', 'in', 'at', 'to', 'of', 'as', 'by']);

function words(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Decide whether a job matches the user's preferences.
 * @returns {[boolean, string]} [passed, reason]
 */
function filterByPreferences(job, prefs) {
  const title = (job.title || '').toLowerCase();
  const titleWords = words(title);
  const desc = (job.description || '').toLowerCase();
  const company = (job.company || '').toLowerCase();

  const roles = prefs.roles || [];

  // Primary: exact substring match (e.g. "Software Engineer" in title)
  const exact = roles.some((r) => title.includes(r.toLowerCase()));

  // Fallback: any significant keyword from any role appears in the title.
  const roleKeywords = new Set();
  for (const role of roles) {
    for (const w of words(role)) {
      if (!STOP.has(w)) roleKeywords.add(w);
    }
  }
  let keywordHit = false;
  for (const kw of roleKeywords) {
    if (kw.length > 3 && titleWords.has(kw)) {
      keywordHit = true;
      break;
    }
  }

  if (!(exact || keywordHit)) {
    return [false, `"${job.title}" doesn't match target roles`];
  }

  for (const kw of prefs.avoid_keywords || []) {
    if (desc.includes(kw.toLowerCase())) {
      return [false, `Contains avoided keyword: "${kw}"`];
    }
  }

  for (const co of prefs.avoid_companies || []) {
    if (company.includes(co.toLowerCase())) {
      return [false, `Avoided company: "${co}"`];
    }
  }

  return [true, 'OK'];
}

module.exports = { filterByPreferences };
