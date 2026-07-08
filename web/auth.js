'use strict';

/**
 * Single-user JWT authentication for the dashboard.
 *
 * Credentials live in .env (AUTH_USERNAME / AUTH_PASSWORD). The password is
 * bcrypt-hashed once at startup and verified on login. A signed JWT is issued
 * on success and required (via requireAuth) on every API route.
 *
 * requireAuth accepts the token from either the "Authorization: Bearer" header
 * (used by fetch) OR a "?token=" query param (used by plain <a href> file
 * downloads, which can't set headers).
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config } = require('../src/config');

// Hash each configured password once at import time.
const ADMIN_HASH = bcrypt.hashSync(config.AUTH_PASSWORD, bcrypt.genSaltSync());
const USER_HASH = bcrypt.hashSync(config.USER_PASSWORD, bcrypt.genSaltSync());

/**
 * Returns the account's role ('admin' | 'user') on success, or null on failure.
 * Admin credentials take precedence if the two usernames happen to collide.
 */
function verifyCredentials(username, password) {
  const check = (hash) => {
    try {
      return bcrypt.compareSync(password, hash);
    } catch {
      return false;
    }
  };
  if (username === config.AUTH_USERNAME && check(ADMIN_HASH)) return 'admin';
  if (username === config.USER_USERNAME && check(USER_HASH)) return 'user';
  return null;
}

function createToken(username, role = 'user') {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: username,
    role,
    iat: now,
    exp: now + config.JWT_EXPIRE_HOURS * 3600,
  };
  return jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256' });
}

/**
 * Short-lived (60s) token used only for <a href> downloads, so the real
 * session JWT never appears in a URL (browser history, server logs).
 */
function createDownloadToken(username, role = 'user') {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: username, role, typ: 'dl', iat: now, exp: now + 60 },
    config.JWT_SECRET,
    { algorithm: 'HS256' }
  );
}

function decode(token) {
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
}

/**
 * Express middleware — sets req.user to the authenticated username, or sends 401.
 */
function requireAuth(req, res, next) {
  const authorization = req.headers.authorization;
  const queryToken = req.query.token;
  let raw = null;
  let fromQuery = false;
  if (authorization && authorization.toLowerCase().startsWith('bearer ')) {
    raw = authorization.slice(7).trim();
  } else if (queryToken) {
    raw = queryToken;
    fromQuery = true;
  }
  if (!raw) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  try {
    const payload = decode(raw);
    // Only short-lived download tickets may travel in the URL — a leaked one
    // expires in 60s, unlike the session JWT.
    if (fromQuery && payload.typ !== 'dl') {
      return res.status(401).json({ detail: 'URL auth requires a download ticket (GET /api/download-ticket)' });
    }
    req.user = payload.sub || '';
    req.role = payload.role || 'user';
    return next();
  } catch {
    return res.status(401).json({ detail: 'Invalid or expired token' });
  }
}

/** Express middleware — requires an authenticated admin (401 or 403 otherwise). */
function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.role !== 'admin') {
      return res.status(403).json({ detail: 'Admin access required' });
    }
    return next();
  });
}

module.exports = { verifyCredentials, createToken, createDownloadToken, requireAuth, requireAdmin };
