'use strict';

/**
 * Rule-based job classifier. Maps a job (by its title, with a light assist from
 * any department/team hint) to one or more JobType categories from a fixed
 * taxonomy. Deterministic and offline — no LLM required — so discovery stays
 * fast and predictable. A job can carry several tags (e.g. an intern backend
 * role → ["backend", "internship"]); if nothing matches it falls back to
 * "other". Seniority ("internship") is orthogonal and can co-exist with a
 * functional tag.
 *
 * The dropdown in the dashboard is populated from TAXONOMY, so adding a
 * category here + its keywords is all it takes to extend the filter.
 */

// Ordered so the label list in the UI reads sensibly. id → label.
const TAXONOMY = [
  { id: 'software', label: 'Software Engineering' },
  { id: 'backend', label: 'Backend' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'fullstack', label: 'Full-Stack' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'data-ml', label: 'Data / ML / AI' },
  { id: 'data-eng', label: 'Data Engineering' },
  { id: 'analytics', label: 'Data / Analytics' },
  { id: 'devops', label: 'DevOps / SRE / Infra' },
  { id: 'security', label: 'Security' },
  { id: 'qa', label: 'QA / Test' },
  { id: 'design', label: 'Design' },
  { id: 'product', label: 'Product' },
  { id: 'sales', label: 'Sales / Marketing' },
  { id: 'internship', label: 'Internship / New-grad' },
  { id: 'other', label: 'Other' },
];

const LABELS = Object.fromEntries(TAXONOMY.map((t) => [t.id, t.label]));

// Keyword rules matched against the lowercased title (+ hint). Spaces around
// short tokens (" go ", " ml ") avoid matching inside longer words.
const RULES = {
  fullstack: ['full stack', 'full-stack', 'fullstack'],
  frontend: ['frontend', 'front-end', 'front end', 'react', 'angular', 'vue', 'ui engineer', 'web developer'],
  backend: ['backend', 'back-end', 'back end', 'server-side', 'api engineer', ' golang', ' rust ', 'node.js', 'nodejs'],
  mobile: [' ios', 'android', 'mobile', 'react native', 'flutter', 'swift'],
  'data-ml': ['machine learning', ' ml ', 'ml engineer', ' ai ', 'artificial intelligence', 'deep learning', ' nlp', 'computer vision', 'data scientist', 'research scientist', 'applied scientist', ' llm', 'genai', 'generative ai'],
  'data-eng': ['data engineer', ' etl', 'data platform', 'data infrastructure', 'data pipeline'],
  analytics: ['data analyst', 'analytics', 'business intelligence', ' bi ', 'insights analyst'],
  devops: ['devops', ' sre', 'site reliability', 'infrastructure', 'platform engineer', 'cloud engineer', 'kubernetes', 'systems engineer', 'reliability engineer'],
  security: ['security', 'appsec', 'infosec', 'cryptograph', 'penetration'],
  qa: ['quality assurance', 'test engineer', ' sdet', 'qa engineer', 'automation engineer'],
  design: ['designer', ' ux', 'ui/ux', 'product design', 'graphic', 'brand design'],
  product: ['product manager', 'product management', 'program manager', 'technical program', ' tpm'],
  sales: ['sales', 'account executive', 'marketing', 'recruiter', 'customer success', 'business development', 'partnerships'],
};

// Internship/seniority is matched with word boundaries so "intern" doesn't fire
// on "International" and "graduate" doesn't fire on "undergraduate".
const INTERN_RE = /\b(interns?|internships?|trainees?|new[- ]?grads?|graduates?|early[- ]career|apprentices?|co[- ]?op)\b/;

// Generic engineering signal → the catch-all "software" bucket when no more
// specific functional tag fired.
const SOFTWARE_SIGNAL = ['software engineer', 'software developer', ' sde', ' swe', 'engineer', 'developer', 'programmer'];

// Functional (non-seniority) tags — used to decide whether "software" is needed.
const FUNCTIONAL = new Set([
  'backend', 'frontend', 'fullstack', 'mobile', 'data-ml', 'data-eng',
  'analytics', 'devops', 'security', 'qa', 'design', 'product', 'sales', 'software',
]);

class JobClassifier {
  /** @returns {string[]} one or more taxonomy ids. */
  classify(job) {
    const job_ = job || {};
    const hay = ` ${String(job_.title || '')} ${String(job_.hint || '')} `.toLowerCase();
    const tags = new Set();

    for (const [id, kws] of Object.entries(RULES)) {
      if (kws.some((kw) => hay.includes(kw))) tags.add(id);
    }
    if (INTERN_RE.test(hay)) tags.add('internship');

    // If we found only seniority (internship) or nothing functional, but the
    // title clearly reads as an engineering role, add the generic bucket.
    const hasFunctional = [...tags].some((t) => FUNCTIONAL.has(t));
    if (!hasFunctional && SOFTWARE_SIGNAL.some((kw) => hay.includes(kw))) {
      // Exclude obvious non-software "engineer" roles (sales/mechanical/etc.).
      if (!/sales engineer|mechanical|electrical|civil|hardware/.test(hay)) {
        tags.add('software');
      }
    }

    if (tags.size === 0) tags.add('other');
    return [...tags];
  }

  /** Tag a list of jobs in place, returning the same list. */
  classifyAll(jobs) {
    for (const job of jobs) job.categories = this.classify(job);
    return jobs;
  }
}

module.exports = { JobClassifier, TAXONOMY, LABELS };
