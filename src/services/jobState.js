'use strict';

// Keep at most this many recent log lines in memory per background job.
const MAX_LOG_LINES = 500;

/**
 * Observable state for a background job (crawl / discovery): a running flag
 * and a capped log with a monotonically growing absolute offset, so clients
 * can poll incrementally with ?since=<offset> instead of re-downloading the
 * whole log on every tick.
 */
function createJobState() {
  return {
    running: false,
    last_run: null,
    log: [], // most recent lines only (capped at MAX_LOG_LINES)
    log_start: 0, // absolute index of log[0]

    reset(lines = []) {
      this.log = [...lines];
      this.log_start = 0;
    },

    push(line) {
      this.log.push(line);
      if (this.log.length > MAX_LOG_LINES) {
        const drop = this.log.length - MAX_LOG_LINES;
        this.log.splice(0, drop);
        this.log_start += drop;
      }
    },

    /**
     * JSON view for status endpoints. With `since` (absolute offset of lines
     * the client already has) only newer lines are returned; without it, the
     * full capped log — which keeps the old response shape working.
     */
    view(since = null, extra = {}) {
      const total = this.log_start + this.log.length;
      let log = this.log;
      if (since != null && Number.isFinite(since)) {
        log = this.log.slice(Math.max(since - this.log_start, 0));
      }
      return { running: this.running, last_run: this.last_run, log, log_offset: total, ...extra };
    },
  };
}

module.exports = { createJobState };
