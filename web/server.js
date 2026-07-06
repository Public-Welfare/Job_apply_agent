'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');

const BASE_DIR = path.resolve(__dirname, '..');

const { config } = require('../src/config');
const { importResume } = require('../src/resume/latexImporter');
const { JobCacheService } = require('../src/services/jobCacheService');
const { TrackerService } = require('../src/services/trackerService');
const { DiscoveryService } = require('../src/services/discoveryService');
const { RoleService } = require('../src/services/roleService');
const llm = require('../src/services/llm');
const { TAXONOMY, LABELS } = require('../src/services/jobClassifier');
const { createToken, requireAuth, requireAdmin, verifyCredentials } = require('./auth');

const STATIC_DIR = path.join(__dirname, 'static');
// Strip ANSI colour codes and carriage returns from crawl subprocess output.
const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJST]|\x1b\[[?][0-9]*[hl]|\r/g;

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const tracker = new TrackerService();
const jobCache = new JobCacheService();
const roleService = new RoleService();

const crawlState = { running: false, log: [], last_run: null };
const discoveryState = { running: false, log: [], last_run: null, summary: null };

// ── Persistent crawl state ─────────────────────────────────────────────────
// last_run survives restarts so the daily scheduler doesn't re-crawl on boot.

function loadLastRun() {
  try {
    const data = JSON.parse(fs.readFileSync(config.CRAWL_STATE_PATH, 'utf-8'));
    return data.last_run || null;
  } catch {
    return null;
  }
}

function saveLastRun(ts) {
  fs.mkdirSync(path.dirname(config.CRAWL_STATE_PATH), { recursive: true });
  fs.writeFileSync(config.CRAWL_STATE_PATH, JSON.stringify({ last_run: ts }), 'utf-8');
}

crawlState.last_run = loadLastRun();

// Small helper so async route handlers surface {detail} errors like FastAPI.
class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Pages ───────────────────────────────────────────────────────────────────

app.use('/static', express.static(STATIC_DIR));

app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(STATIC_DIR, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const role = verifyCredentials(username, password);
  if (!role) {
    return res.status(401).json({ detail: 'Invalid username or password' });
  }
  return res.json({ token: createToken(username, role), username, role });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ username: req.user, role: req.role }));

// ── AI backend (Ollama or a hosted free provider) ──────────────────────────────

app.get('/api/llm/status', requireAuth, wrap(async (req, res) => res.json(await llm.status())));

// Set a free AI API token when Ollama isn't available (admin only).
app.post('/api/llm/token', requireAdmin, wrap(async (req, res) => {
  const { provider, api_key, model } = req.body || {};
  try {
    return res.json(await llm.setToken({ provider, api_key, model }));
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}));

app.delete('/api/llm/token', requireAdmin, wrap(async (req, res) => {
  llm.clearToken();
  return res.json(await llm.status());
}));

// ── Applications ──────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const apps = tracker.getAll();
  const out = { total: apps.length, applied: 0, not_applied: 0, interview: 0, offer: 0, rejected: 0 };
  for (const a of apps) {
    if (a.status in out) out[a.status] += 1;
  }
  res.json(out);
});

app.get('/api/applications', requireAuth, (req, res) => {
  const { status, source, search, sort = 'newest' } = req.query;
  let apps = tracker.getAll(status || null);
  if (source) apps = apps.filter((a) => a.source === source);
  if (search) {
    const q = String(search).toLowerCase();
    apps = apps.filter(
      (a) => a.title.toLowerCase().includes(q) || (a.company || '').toLowerCase().includes(q)
    );
  }
  apps.sort((a, b) => {
    const cmp = a.applied_at < b.applied_at ? -1 : a.applied_at > b.applied_at ? 1 : 0;
    return sort === 'newest' ? -cmp : cmp;
  });
  res.json(apps);
});

app.patch('/api/applications/:jobId/status', requireAuth, (req, res) => {
  const valid = new Set(['applied', 'not_applied', 'interview', 'offer', 'rejected']);
  const { status, notes = '' } = req.body || {};
  if (!valid.has(status)) {
    return res.status(400).json({ detail: `status must be one of ${[...valid].sort().join(', ')}` });
  }
  const result = tracker.updateStatus(req.params.jobId, status, notes);
  if (!result) return res.status(404).json({ detail: 'Application not found' });
  return res.json(result);
});

app.delete('/api/applications/:jobId', requireAuth, (req, res) => {
  if (!tracker.delete(req.params.jobId)) {
    return res.status(404).json({ detail: 'Application not found' });
  }
  return res.json({ deleted: true });
});

app.get('/api/resume/:jobId', requireAuth, (req, res) => {
  const apps = tracker.getAll();
  const entry = apps.find((a) => a.id === req.params.jobId);
  if (!entry) return res.status(404).json({ detail: 'Application not found' });
  let p = entry.resume_path;
  if (!path.isAbsolute(p)) p = path.join(BASE_DIR, p);
  if (!fs.existsSync(p)) return res.status(404).json({ detail: 'Resume file not found on disk' });
  return res.download(p, path.basename(p));
});

// ── LaTeX resume import ───────────────────────────────────────────────────────

app.post(
  '/api/resume/import',
  requireAuth,
  upload.single('file'),
  wrap(async (req, res) => {
    // Accept either pasted text (JSON { text }) or an uploaded .tex/.txt file.
    const file = req.file;
    const pasted = req.body && typeof req.body.text === 'string' ? req.body.text : '';
    let raw;
    let originName;
    if (pasted.trim()) {
      raw = pasted;
      originName = (req.body && req.body.name) || 'resume';
    } else if (file) {
      const name = file.originalname || '';
      if (!name.toLowerCase().endsWith('.tex') && !name.toLowerCase().endsWith('.txt')) {
        throw new HttpError(400, 'Please upload a LaTeX (.tex) file');
      }
      raw = file.buffer.toString('utf-8');
      originName = path.parse(name).name;
    } else {
      throw new HttpError(400, 'Paste your resume text (or upload a .tex file)');
    }
    if (!raw.trim()) throw new HttpError(400, 'Resume text is empty');
    const roles = Array.isArray(req.body && req.body.roles)
      ? req.body.roles.map((r) => String(r).trim()).filter(Boolean)
      : [];
    let result;
    try {
      result = await importResume(raw, originName, { roles });
    } catch (e) {
      throw new HttpError(500, `Import failed: ${e.message}`);
    }
    const fileUrl = (f) => `/api/resume/import/file/${f}`;
    res.json({
      name: result.name,
      base: { tex_url: fileUrl(result.base.tex_file), pdf_url: fileUrl(result.base.pdf_file) },
      variants: result.variants.map((v) => ({
        jobType: v.jobType,
        label: v.label,
        tailored: v.tailored,
        tex_url: fileUrl(v.tex_file),
        pdf_url: fileUrl(v.pdf_file),
      })),
    });
  })
);

app.get('/api/resume/import/list', requireAuth, (req, res) => {
  if (!fs.existsSync(config.IMPORTS_DIR)) return res.json([]);
  const grouped = {};
  for (const f of fs.readdirSync(config.IMPORTS_DIR)) {
    const ext = path.extname(f);
    if (ext === '.tex' || ext === '.pdf') {
      const stem = path.basename(f, ext);
      (grouped[stem] = grouped[stem] || {})[ext.slice(1)] = f;
    }
  }
  const out = Object.entries(grouped).map(([stem, files]) => ({
    name: stem,
    tex_url: files.tex ? `/api/resume/import/file/${files.tex}` : null,
    pdf_url: files.pdf ? `/api/resume/import/file/${files.pdf}` : null,
  }));
  out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  res.json(out);
});

app.get('/api/resume/import/file/:filename', requireAuth, (req, res) => {
  const safe = path.basename(req.params.filename); // block path traversal
  const p = path.join(config.IMPORTS_DIR, safe);
  if (!fs.existsSync(p)) return res.status(404).json({ detail: 'File not found' });
  return res.download(p, safe);
});

// ── Cached job descriptions ────────────────────────────────────────────────────

app.get('/api/jobs/cached', requireAuth, (req, res) => {
  const search = req.query.search || null;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? 20, 10) || 20, 100));
  res.json({ stats: jobCache.stats(), jobs: jobCache.popular(limit, search) });
});

app.get('/api/jobs/cached/:jobId', requireAuth, (req, res) => {
  const entry = jobCache.get(req.params.jobId);
  if (!entry) return res.status(404).json({ detail: 'Job not in cache' });
  jobCache.recordUse(req.params.jobId); // opening a description counts as a hit
  return res.json(entry);
});

// ── Roles (the person's target roles, tracked in the DB) ───────────────────────

app.get('/api/roles', requireAuth, (req, res) => res.json(roleService.all()));

app.post('/api/roles', requireAuth, (req, res) => {
  const { role, location = '' } = req.body || {};
  if (!role || !String(role).trim()) return res.status(400).json({ detail: 'role is required' });
  return res.json(roleService.upsert(String(role).trim(), String(location).trim()));
});

app.delete('/api/roles/:id', requireAuth, (req, res) => {
  if (!roleService.remove(parseInt(req.params.id, 10))) {
    return res.status(404).json({ detail: 'Role not found' });
  }
  return res.json({ deleted: true });
});

// ── Job types + type-filtered browse (powers the dashboard dropdown) ────────────

// The full taxonomy with a live count per type — used to populate the dropdown.
app.get('/api/job-types', requireAuth, (req, res) => {
  const counts = jobCache.typeCounts();
  const types = TAXONOMY.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] || 0 }));
  res.json({ types, total: jobCache.stats().cached });
});

// Jobs from ALL sources filtered by the selected types (comma-separated).
// No types → everything. Results also grouped by type for the UI.
app.get('/api/jobs', requireAuth, (req, res) => {
  const types = String(req.query.types || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const search = req.query.search || null;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? 300, 10) || 300, 1000));
  const jobs = jobCache.byTypes(types, { search, limit });

  const groups = {};
  for (const j of jobs) {
    const tags = j.categories.length ? j.categories : ['other'];
    for (const c of tags) {
      if (types.length && !types.includes(c)) continue;
      (groups[c] = groups[c] || []).push(j);
    }
  }
  res.json({ total: jobs.length, selected: types, jobs, groups, labels: LABELS });
});

// Trigger an in-process discovery (multi-source fetch + classify + cache).
app.post('/api/jobs/refresh', requireAuth, (req, res) => {
  if (discoveryState.running) {
    return res.status(409).json({ detail: 'Discovery already in progress' });
  }
  runDiscovery(); // fire and forget
  return res.json({ started: true });
});

app.get('/api/jobs/refresh/status', requireAuth, (req, res) => res.json(discoveryState));

// ── Crawl control ─────────────────────────────────────────────────────────────

// True when a run happened within CRAWL_INTERVAL_HOURS (i.e. "less than 24h ago").
function ranRecently(lastRun) {
  if (!lastRun) return false;
  const t = Date.parse(lastRun);
  if (Number.isNaN(t)) return false;
  return (Date.now() - t) / (3600 * 1000) < config.CRAWL_INTERVAL_HOURS;
}

app.post('/api/crawl', requireAuth, (req, res) => {
  if (crawlState.running) return res.status(409).json({ detail: 'A crawl is already in progress' });
  // Rate limit: within the interval, only an admin may start a new crawl.
  if (ranRecently(crawlState.last_run) && req.role !== 'admin') {
    return res.status(403).json({
      detail: `A crawl ran less than ${config.CRAWL_INTERVAL_HOURS}h ago. Only an admin can start another before then.`,
    });
  }
  // Optional: crawl only the roles the user picked (else all profile roles).
  const roles = Array.isArray(req.body && req.body.roles)
    ? req.body.roles.map((r) => String(r).trim()).filter(Boolean)
    : [];
  runCrawl(true, roles); // manual crawl always fetches fresh (fire and forget)
  res.json({ started: true, roles });
});

app.get('/api/crawl/status', requireAuth, (req, res) => res.json(crawlState));

app.get('/api/crawl/schedule', requireAuth, (req, res) => {
  const last = crawlState.last_run;
  let nextDue = null;
  if (last) {
    const t = Date.parse(last);
    if (!Number.isNaN(t)) nextDue = new Date(t + config.CRAWL_INTERVAL_HOURS * 3600 * 1000).toISOString();
  }
  // A user may crawl if none ran recently, or if they're an admin.
  const mayCrawl = req.role === 'admin' || !ranRecently(last);
  res.json({
    auto_crawl: config.AUTO_CRAWL,
    interval_hours: config.CRAWL_INTERVAL_HOURS,
    cache_ttl_hours: config.JOB_CACHE_TTL_HOURS,
    last_run: last,
    next_run: nextDue,
    running: crawlState.running,
    role: req.role,
    may_crawl: mayCrawl,
    ran_recently: ranRecently(last),
  });
});

// Central error handler → {detail} like FastAPI's HTTPException.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const detail = err.detail || err.message || 'Internal Server Error';
  if (!res.headersSent) res.status(status).json({ detail });
});

// ── Background discovery (in-process: ATS APIs + RemoteOK, no browser/LLM) ──────

async function runDiscovery() {
  discoveryState.running = true;
  discoveryState.log = ['Starting discovery…'];
  discoveryState.summary = null;
  try {
    const summary = await new DiscoveryService(null, null, jobCache).run((line) =>
      discoveryState.log.push(line)
    );
    discoveryState.summary = summary;
    discoveryState.log.push(`Done — ${summary.total} jobs cached`);
  } catch (exc) {
    discoveryState.log.push(`Error: ${exc.message}`);
  } finally {
    discoveryState.running = false;
    discoveryState.last_run = new Date().toISOString();
  }
}

// ── Background crawl ──────────────────────────────────────────────────────────

function runCrawl(forceFresh = true, roles = []) {
  crawlState.running = true;
  crawlState.log = roles.length
    ? [`Starting crawl for: ${roles.join(', ')}…`]
    : ['Starting crawl…'];
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      CRAWL_FORCE_FRESH: forceFresh ? '1' : '0',
      // Empty → main.js falls back to all profile roles.
      CRAWL_ROLES: JSON.stringify(roles || []),
    };
    let proc;
    try {
      proc = spawn(process.execPath, ['main.js', 'crawl'], { cwd: BASE_DIR, env });
    } catch (exc) {
      crawlState.log.push(`Error: ${exc.message}`);
      finish();
      return;
    }

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(ANSI_RE, '').trim();
        buffer = buffer.slice(idx + 1);
        if (line) crawlState.log.push(line);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (exc) => {
      crawlState.log.push(`Error: ${exc.message}`);
    });

    proc.on('close', (code) => {
      const tail = buffer.replace(ANSI_RE, '').trim();
      if (tail) crawlState.log.push(tail);
      crawlState.log.push(`Done — exit code ${code}`);
      finish();
    });

    function finish() {
      crawlState.running = false;
      const now = new Date().toISOString();
      crawlState.last_run = now;
      saveLastRun(now);
      resolve();
    }
  });
}

// ── Daily auto-crawl scheduler ─────────────────────────────────────────────────
// Wake up periodically; if the last crawl was more than CRAWL_INTERVAL_HOURS ago,
// kick off a fresh one. last_run is persisted, so a restart won't force a re-crawl.

function isCrawlDue() {
  const last = crawlState.last_run;
  if (!last) return true; // never crawled — do it once on first launch
  const t = Date.parse(last);
  if (Number.isNaN(t)) return true;
  const ageHours = (Date.now() - t) / (3600 * 1000);
  return ageHours >= config.CRAWL_INTERVAL_HOURS;
}

async function schedulerTick() {
  try {
    if (!crawlState.running && isCrawlDue()) {
      crawlState.log = ['Auto-crawl triggered (daily schedule)…'];
      await runCrawl(true);
    }
  } catch (exc) {
    crawlState.log.push(`Scheduler error: ${exc.message}`);
  }
}

function startScheduler() {
  if (!config.AUTO_CRAWL) return;
  const checkEvery = 15 * 60 * 1000; // re-check every 15 minutes
  const loop = () => {
    schedulerTick().finally(() => {
      const t = setTimeout(loop, checkEvery);
      t.unref(); // don't keep the process alive purely for the scheduler
    });
  };
  loop();
}

const PORT = parseInt(process.env.PORT || '8080', 10);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Job Apply Agent dashboard → http://localhost:${PORT}`);
    startScheduler();
  });
}

module.exports = { app };
