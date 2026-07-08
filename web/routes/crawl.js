'use strict';

const express = require('express');
const { config } = require('../../src/config');
const crawl = require('../../src/services/crawlRunner');
const { requireAuth } = require('../auth');

const parseSince = (v) => {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

module.exports = () => {
  const router = express.Router();

  router.post('/api/crawl', requireAuth, (req, res) => {
    if (crawl.state.running) return res.status(409).json({ detail: 'A crawl is already in progress' });
    // Rate limit: within the interval, only an admin may start a new crawl.
    if (crawl.ranRecently() && req.role !== 'admin') {
      return res.status(403).json({
        detail: `A crawl ran less than ${config.CRAWL_INTERVAL_HOURS}h ago. Only an admin can start another before then.`,
      });
    }
    // Optional: crawl only the roles the user picked (else all profile roles).
    const roles = Array.isArray(req.body && req.body.roles)
      ? req.body.roles.map((r) => String(r).trim()).filter(Boolean)
      : [];
    crawl.runCrawl(true, roles); // manual crawl always fetches fresh (fire and forget)
    res.json({ started: true, roles });
  });

  router.get('/api/crawl/status', requireAuth, (req, res) =>
    res.json(crawl.state.view(parseSince(req.query.since)))
  );

  router.get('/api/crawl/schedule', requireAuth, (req, res) => {
    const last = crawl.state.last_run;
    let nextDue = null;
    if (last) {
      const t = Date.parse(last);
      if (!Number.isNaN(t)) nextDue = new Date(t + config.CRAWL_INTERVAL_HOURS * 3600 * 1000).toISOString();
    }
    // A user may crawl if none ran recently, or if they're an admin.
    const mayCrawl = req.role === 'admin' || !crawl.ranRecently();
    res.json({
      auto_crawl: config.AUTO_CRAWL,
      interval_hours: config.CRAWL_INTERVAL_HOURS,
      cache_ttl_hours: config.JOB_CACHE_TTL_HOURS,
      last_run: last,
      next_run: nextDue,
      running: crawl.state.running,
      role: req.role,
      may_crawl: mayCrawl,
      ran_recently: crawl.ranRecently(),
    });
  });

  return router;
};
