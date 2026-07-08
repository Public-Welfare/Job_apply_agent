'use strict';

const express = require('express');
const { createToken, createDownloadToken, requireAuth, verifyCredentials } = require('../auth');
const { rateLimit } = require('../rateLimit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  detail: 'Too many login attempts. Try again in a few minutes.',
});

router.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const role = verifyCredentials(username, password);
  if (!role) {
    return res.status(401).json({ detail: 'Invalid username or password' });
  }
  return res.json({ token: createToken(username, role), username, role });
});

router.get('/api/me', requireAuth, (req, res) => res.json({ username: req.user, role: req.role }));

// Short-lived token for <a href> downloads (links can't set headers), so the
// real session JWT never appears in a URL.
router.get('/api/download-ticket', requireAuth, (req, res) =>
  res.json({ token: createDownloadToken(req.user, req.role), expires_in: 60 })
);

module.exports = router;
