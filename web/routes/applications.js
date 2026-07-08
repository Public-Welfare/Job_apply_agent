'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { config } = require('../../src/config');
const { requireAuth } = require('../auth');

module.exports = ({ tracker }) => {
  const router = express.Router();

  router.get('/api/stats', requireAuth, (req, res) => res.json(tracker.stats()));

  router.get('/api/applications', requireAuth, (req, res) => {
    const { status, source, search, sort = 'newest' } = req.query;
    res.json(tracker.query({ status, source, search, sort }));
  });

  router.patch('/api/applications/:jobId/status', requireAuth, (req, res) => {
    const valid = new Set(['applied', 'not_applied', 'interview', 'offer', 'rejected']);
    const { status, notes = '' } = req.body || {};
    if (!valid.has(status)) {
      return res.status(400).json({ detail: `status must be one of ${[...valid].sort().join(', ')}` });
    }
    const result = tracker.updateStatus(req.params.jobId, status, notes);
    if (!result) return res.status(404).json({ detail: 'Application not found' });
    return res.json(result);
  });

  router.delete('/api/applications/:jobId', requireAuth, (req, res) => {
    if (!tracker.delete(req.params.jobId)) {
      return res.status(404).json({ detail: 'Application not found' });
    }
    return res.json({ deleted: true });
  });

  router.get('/api/resume/:jobId', requireAuth, (req, res) => {
    const entry = tracker.getOne(req.params.jobId);
    if (!entry) return res.status(404).json({ detail: 'Application not found' });
    let p = entry.resume_path;
    if (!p) return res.status(404).json({ detail: 'No resume for this application' });
    if (!path.isAbsolute(p)) p = path.join(config.BASE_DIR, p);
    if (!fs.existsSync(p)) return res.status(404).json({ detail: 'Resume file not found on disk' });
    return res.download(p, path.basename(p));
  });

  return router;
};
