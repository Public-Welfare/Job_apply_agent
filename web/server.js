'use strict';

/**
 * Composition root for the dashboard: builds services, mounts the routers,
 * and (when run directly) boots the HTTP server + background scheduler.
 * Route logic lives in web/routes/*; background jobs in src/services/*Runner.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const { config } = require('../src/config');
const { TrackerService } = require('../src/services/trackerService');
const { JobCacheService } = require('../src/services/jobCacheService');
const { RoleService } = require('../src/services/roleService');
const { startScheduler } = require('../src/services/scheduler');

const STATIC_DIR = path.join(__dirname, 'static');

const app = express();
app.use(express.json());

const tracker = new TrackerService();
const jobCache = new JobCacheService();
const roleService = new RoleService();

// ── Pages ───────────────────────────────────────────────────────────────────

app.use('/static', express.static(STATIC_DIR));

app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(STATIC_DIR, 'login.html')));

// The dashboard is a React app built by Vite into web/static/dist
// (assets load from /static/dist/, which express.static above serves).
app.get('/dashboard', (req, res) => {
  const built = path.join(STATIC_DIR, 'dist', 'index.html');
  if (fs.existsSync(built)) return res.sendFile(built);
  return res
    .status(503)
    .send('Dashboard build missing — run: npm run build:ui (see README).');
});

// ── API routes ───────────────────────────────────────────────────────────────

app.use(require('./routes/auth'));
app.use(require('./routes/llm'));
app.use(require('./routes/applications')({ tracker }));
app.use(require('./routes/resume')());
app.use(require('./routes/jobs')({ jobCache, roleService }));
app.use(require('./routes/crawl')());

// Central error handler → {detail} like FastAPI's HTTPException.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  let status = err.status || 500;
  let detail = err.detail || err.message || 'Internal Server Error';
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    detail = 'File too large (max 2 MB)';
  }
  if (!res.headersSent) res.status(status).json({ detail });
});

// Refuse to boot a production deploy that still uses shipped default secrets.
function assertProductionSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems = [];
  if (config.JWT_SECRET === 'dev-insecure-secret-change-me') problems.push('JWT_SECRET');
  if (config.AUTH_PASSWORD === 'changeme') problems.push('AUTH_PASSWORD');
  if (problems.length) {
    console.error(
      `Refusing to start: ${problems.join(' and ')} still set to the shipped default. ` +
        'Set real values in the environment (see DEPLOY-RAILWAY.md).'
    );
    process.exit(1);
  }
  if (config.USER_PASSWORD === 'user') {
    console.warn('[warn] USER_PASSWORD is still the default ("user") — change it.');
  }
}

const PORT = parseInt(process.env.PORT || '8080', 10);

if (require.main === module) {
  assertProductionSecrets();
  const pruned = jobCache.prune(config.JOB_CACHE_PRUNE_DAYS);
  if (pruned) console.log(`[cache] pruned ${pruned} cached jobs unseen for ${config.JOB_CACHE_PRUNE_DAYS}+ days`);
  app.listen(PORT, () => {
    console.log(`Job Apply Agent dashboard → http://localhost:${PORT}`);
    startScheduler(jobCache);
  });
}

module.exports = { app };
