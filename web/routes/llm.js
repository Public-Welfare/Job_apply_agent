'use strict';

const express = require('express');
const llm = require('../../src/services/llm');
const { requireAuth, requireAdmin } = require('../auth');
const { HttpError, wrap } = require('../httpError');

const router = express.Router();

router.get('/api/llm/status', requireAuth, wrap(async (req, res) => res.json(await llm.status())));

// Set a free AI API token when Ollama isn't available (admin only).
router.post('/api/llm/token', requireAdmin, wrap(async (req, res) => {
  const { provider, api_key, model } = req.body || {};
  try {
    return res.json(await llm.setToken({ provider, api_key, model }));
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}));

router.delete('/api/llm/token', requireAdmin, wrap(async (req, res) => {
  llm.clearToken();
  return res.json(await llm.status());
}));

module.exports = router;
