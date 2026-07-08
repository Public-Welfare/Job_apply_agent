'use strict';

/**
 * Tiny fixed-window per-IP rate limiter — enough to blunt login brute-force
 * without pulling in a dependency. In-memory, so limits reset on restart
 * (fine for this purpose).
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, detail = 'Too many attempts. Try again later.' } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let h = hits.get(ip);
    if (!h || now >= h.resetAt) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(ip, h);
    }
    h.count += 1;
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    if (h.count > max) {
      res.set('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      return res.status(429).json({ detail });
    }
    return next();
  };
}

module.exports = { rateLimit };
