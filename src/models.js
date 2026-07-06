'use strict';

const fs = require('fs');
const { config } = require('./config');

// ── Job ─────────────────────────────────────────────────────────────────────
// Mirrors the Pydantic Job model: id/title/apply_url are required; the rest
// default to empty strings.

function makeJob(data) {
  const d = data || {};
  for (const req of ['id', 'title', 'apply_url']) {
    if (!d[req]) throw new Error(`Job missing required field: ${req}`);
  }
  return {
    id: String(d.id),
    title: String(d.title),
    company: d.company != null ? String(d.company) : '',
    location: d.location != null ? String(d.location) : '',
    salary: d.salary != null ? String(d.salary) : '',
    apply_url: String(d.apply_url),
    description: d.description != null ? String(d.description) : '',
    source: d.source != null ? String(d.source) : '',
    // Job-type tags assigned by JobClassifier (e.g. ["backend","internship"]).
    categories: Array.isArray(d.categories) ? d.categories.map(String) : [],
  };
}

// ── CustomizedResume validation ─────────────────────────────────────────────
// Mirrors CustomizedResume.model_validate — throws on a malformed LLM payload
// so the customizer retries, exactly like the Python Pydantic version.

function _str(obj, field, where) {
  if (typeof obj[field] !== 'string') {
    throw new Error(`${where}.${field} must be a string`);
  }
  return obj[field];
}

function _requireKeys(obj, keys, where) {
  if (obj == null || typeof obj !== 'object') {
    throw new Error(`${where} must be an object`);
  }
  for (const k of keys) {
    if (!(k in obj)) throw new Error(`${where} missing required field: ${k}`);
  }
}

function _list(obj, field) {
  const v = obj[field];
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${field} must be a list`);
  return v;
}

function validatePersonal(p) {
  _requireKeys(p, ['name', 'email', 'phone', 'linkedin', 'github', 'location'], 'personal');
  return {
    name: _str(p, 'name', 'personal'),
    email: _str(p, 'email', 'personal'),
    phone: _str(p, 'phone', 'personal'),
    linkedin: _str(p, 'linkedin', 'personal'),
    github: _str(p, 'github', 'personal'),
    location: _str(p, 'location', 'personal'),
    codeforces: p.codeforces != null ? String(p.codeforces) : '',
  };
}

function validateSkills(s) {
  const src = s && typeof s === 'object' ? s : {};
  const arr = (f) => (Array.isArray(src[f]) ? src[f].map(String) : []);
  return {
    languages: arr('languages'),
    frameworks: arr('frameworks'),
    tools: arr('tools'),
    databases: arr('databases'),
  };
}

function validateExperience(list) {
  return _list({ experience: list }, 'experience').map((e, i) => {
    _requireKeys(e, ['company', 'role', 'duration', 'location', 'bullets'], `experience[${i}]`);
    if (!Array.isArray(e.bullets)) throw new Error(`experience[${i}].bullets must be a list`);
    return {
      company: String(e.company),
      role: String(e.role),
      duration: String(e.duration),
      location: String(e.location),
      bullets: e.bullets.map(String),
    };
  });
}

function validateEducation(list) {
  return _list({ education: list }, 'education').map((e, i) => {
    _requireKeys(e, ['institution', 'degree', 'year'], `education[${i}]`);
    return {
      institution: String(e.institution),
      degree: String(e.degree),
      year: String(e.year),
      gpa: e.gpa != null ? String(e.gpa) : '',
      coursework: e.coursework != null ? String(e.coursework) : '',
    };
  });
}

function validateProjects(list) {
  return _list({ projects: list }, 'projects').map((p, i) => {
    _requireKeys(p, ['name', 'description', 'tech'], `projects[${i}]`);
    if (!Array.isArray(p.tech)) throw new Error(`projects[${i}].tech must be a list`);
    return {
      name: String(p.name),
      description: String(p.description),
      tech: p.tech.map(String),
      link: p.link != null ? String(p.link) : '',
    };
  });
}

function validateCustomizedResume(data) {
  if (data == null || typeof data !== 'object') {
    throw new Error('CustomizedResume payload must be an object');
  }
  _requireKeys(data, ['personal', 'summary', 'skills', 'experience', 'education', 'projects'], 'resume');
  return {
    keywords_matched: Array.isArray(data.keywords_matched) ? data.keywords_matched.map(String) : [],
    personal: validatePersonal(data.personal),
    summary: _str(data, 'summary', 'resume'),
    skills: validateSkills(data.skills),
    experience: validateExperience(data.experience),
    education: validateEducation(data.education),
    projects: validateProjects(data.projects),
    achievements: Array.isArray(data.achievements) ? data.achievements.map(String) : [],
  };
}

// ── Profile ─────────────────────────────────────────────────────────────────

function loadProfile() {
  const raw = fs.readFileSync(config.PROFILE_PATH, 'utf-8');
  const profile = JSON.parse(raw);
  // Light sanity check mirroring the Pydantic UserProfile required shape.
  _requireKeys(profile, ['personal', 'summary', 'skills', 'preferences'], 'profile');
  const prefs = profile.preferences || {};
  profile.preferences = {
    roles: prefs.roles || [],
    locations: prefs.locations || [],
    min_salary_lpa: prefs.min_salary_lpa || 0,
    avoid_keywords: prefs.avoid_keywords || [],
    avoid_companies: prefs.avoid_companies || [],
  };
  profile.achievements = profile.achievements || [];
  return profile;
}

module.exports = { makeJob, validateCustomizedResume, loadProfile };
