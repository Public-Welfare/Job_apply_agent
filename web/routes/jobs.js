'use strict';

const express = require('express');
const { TAXONOMY, LABELS } = require('../../src/services/jobClassifier');
const discovery = require('../../src/services/discoveryRunner');
const { requireAuth } = require('../auth');

const parseSince = (v) => {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

module.exports = ({ jobCache, roleService }) => {
  const router = express.Router();

  // ── Cached job descriptions ─────────────────────────────────────────────

  router.get('/api/jobs/cached', requireAuth, (req, res) => {
    const search = req.query.search || null;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? 20, 10) || 20, 100));
    res.json({ stats: jobCache.stats(), jobs: jobCache.popular(limit, search) });
  });

  router.get('/api/jobs/cached/:jobId', requireAuth, (req, res) => {
    const entry = jobCache.get(req.params.jobId);
    if (!entry) return res.status(404).json({ detail: 'Job not in cache' });
    jobCache.recordUse(req.params.jobId); // opening a description counts as a hit
    return res.json(entry);
  });

  // ── Roles (the person's target roles, tracked in the DB) ────────────────

  router.get('/api/roles', requireAuth, (req, res) => res.json(roleService.all()));

  router.post('/api/roles', requireAuth, (req, res) => {
    const { role, location = '' } = req.body || {};
    if (!role || !String(role).trim()) return res.status(400).json({ detail: 'role is required' });
    return res.json(roleService.upsert(String(role).trim(), String(location).trim()));
  });

  router.delete('/api/roles/:id', requireAuth, (req, res) => {
    if (!roleService.remove(parseInt(req.params.id, 10))) {
      return res.status(404).json({ detail: 'Role not found' });
    }
    return res.json({ deleted: true });
  });

  // ── Job types + type-filtered browse (powers the dashboard dropdown) ────

  // The full taxonomy with a live count per type — used to populate the dropdown.
  router.get('/api/job-types', requireAuth, (req, res) => {
    const counts = jobCache.typeCounts();
    const types = TAXONOMY.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] || 0 }));
    res.json({ types, total: jobCache.stats().cached });
  });

  // Jobs from ALL sources filtered by the selected types (comma-separated).
  // No types → everything. Results also grouped by type for the UI.
  router.get('/api/jobs', requireAuth, (req, res) => {
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
  router.post('/api/jobs/refresh', requireAuth, (req, res) => {
    if (discovery.state.running) {
      return res.status(409).json({ detail: 'Discovery already in progress' });
    }
    discovery.runDiscovery(jobCache); // fire and forget
    return res.json({ started: true });
  });

  router.get('/api/jobs/refresh/status', requireAuth, (req, res) =>
    res.json(discovery.state.view(parseSince(req.query.since), { summary: discovery.state.summary }))
  );

  return router;
};
