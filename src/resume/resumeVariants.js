'use strict';

/**
 * Resume inheritance model.
 *
 *   BaseResume ──▶ SpecializedResume (extends)
 *
 * A SpecializedResume inherits the base's structured data (a deep copy) and
 * then modifies it for a target job type: it injects that role's ATS keywords
 * into the Skills section and adds a keyword-rich Summary. If the base already
 * covers the role (keywords present), the change is minimal — "same role → ok";
 * a different role (e.g. an AI/ML target) gets its wording boosted.
 *
 * Keyword injection is rule-based (deterministic, no LLM) so a base import can
 * fan out into several specialised PDFs quickly.
 */

const { renderResumeTex } = require('./latexTemplate');
const { LABELS } = require('../services/jobClassifier');

// ATS keyword sets per jobClassifier taxonomy id.
const ROLE_KEYWORDS = {
  software: ['Software Engineering', 'Data Structures', 'Algorithms', 'System Design', 'Git', 'Testing'],
  backend: ['REST APIs', 'Microservices', 'Databases', 'SQL', 'System Design', 'Scalability', 'Caching'],
  frontend: ['React', 'TypeScript', 'HTML', 'CSS', 'Responsive Design', 'Accessibility', 'State Management'],
  fullstack: ['Full-Stack Development', 'React', 'Node.js', 'REST APIs', 'Databases', 'CI/CD'],
  mobile: ['iOS', 'Android', 'React Native', 'Mobile UI', 'REST APIs', 'Offline Sync'],
  'data-ml': ['Machine Learning', 'Deep Learning', 'Neural Networks', 'NLP', 'Computer Vision', 'PyTorch', 'TensorFlow', 'LLMs', 'Model Training', 'Data Pipelines'],
  'data-eng': ['Data Engineering', 'ETL', 'Apache Spark', 'Airflow', 'Data Warehousing', 'SQL', 'Pipelines'],
  analytics: ['Data Analysis', 'SQL', 'Dashboards', 'A/B Testing', 'Statistics', 'Data Visualization'],
  devops: ['CI/CD', 'Docker', 'Kubernetes', 'AWS', 'Terraform', 'Monitoring', 'Linux'],
  security: ['Application Security', 'Threat Modeling', 'Penetration Testing', 'Cryptography', 'OWASP'],
  qa: ['Test Automation', 'Selenium', 'Unit Testing', 'Integration Testing', 'CI/CD'],
  design: ['UI/UX Design', 'Figma', 'Prototyping', 'User Research', 'Design Systems'],
  product: ['Product Management', 'Roadmapping', 'Stakeholder Management', 'Analytics', 'Agile'],
  sales: ['Sales', 'CRM', 'Pipeline Management', 'Negotiation', 'Account Management'],
  internship: ['Fast Learner', 'Collaboration', 'Fundamentals', 'Problem Solving'],
  other: [],
};

function deepClone(x) {
  return JSON.parse(JSON.stringify(x || {}));
}

class BaseResume {
  constructor(data) {
    this.data = data || {};
  }

  render() {
    return renderResumeTex(this.data);
  }
}

class SpecializedResume extends BaseResume {
  constructor(base, jobType) {
    super(deepClone(base.data)); // inherit the base text, then modify a copy
    this.jobType = jobType;
    this.label = LABELS[jobType] || jobType;
    this._specialize();
  }

  _specialize() {
    const kws = ROLE_KEYWORDS[this.jobType] || [];

    // What the base already says (title + skills) — used to detect "same role".
    const existing = [
      ...(this.data.skills || []).map((s) => `${s.category} ${asText(s.items)}`),
      ...(this.data.experience || []).map((e) => `${e.title} ${e.company}`),
    ]
      .join(' ')
      .toLowerCase();

    const missing = kws.filter((k) => !existing.includes(k.toLowerCase()));

    // Only add a keyword row when the base doesn't already cover this role.
    // (Same role → nothing missing → base is left essentially as-is.)
    if (missing.length) {
      this.data.skills = [
        { category: `Key Skills — ${this.label}`, items: missing.join(', ') },
        ...(this.data.skills || []),
      ];
    }

    // Keyword-rich, role-targeted summary (helps ATS keyword matching).
    const top = kws.slice(0, 6).join(', ');
    this.data.summary =
      `${this.label}-focused candidate` + (top ? ` with strengths in ${top}.` : '.');
    this.data.target_role = this.label;
    this.data.tailored = missing.length > 0; // false when base already matched
  }
}

function asText(v) {
  return Array.isArray(v) ? v.map(String).join(', ') : String(v || '');
}

/**
 * Build specialised variants from base data for the given job-type ids.
 * @returns {{jobType, label, data, tailored}[]}
 */
function buildVariants(baseData, jobTypeIds) {
  const base = new BaseResume(baseData);
  const out = [];
  for (const id of jobTypeIds || []) {
    const s = new SpecializedResume(base, id);
    out.push({ jobType: id, label: s.label, data: s.data, tailored: s.data.tailored });
  }
  return out;
}

module.exports = { BaseResume, SpecializedResume, buildVariants, ROLE_KEYWORDS };
