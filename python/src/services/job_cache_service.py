"""SQLite-backed cache of crawled job descriptions.

Every job the crawler finds is remembered here with a ``hits`` counter that
climbs each time the same posting shows up again (or is served to a user).
That gives us two things for free:

* **Popularity** — the most-seen / most-requested descriptions rank to the top,
  so the dashboard can show "hot" roles without re-crawling.
* **Freshness** — a search can check the cache first and, if a matching role was
  crawled within ``JOB_CACHE_TTL_HOURS``, serve those descriptions straight from
  disk instead of hitting the network. *No crawl needed for the user.*

It lives in the same ``applications.db`` file as the tracker (separate table),
so the daily crawl subprocess and the web server share one cache with no extra
plumbing. Single responsibility: persist & rank cached job descriptions.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta, timezone

from ..config import config
from ..models import Job

_COLUMNS = [
    "id", "title", "company", "location", "salary", "source", "apply_url",
    "description", "role_query", "hits", "first_cached_at", "last_seen_at",
]

_STOP = {"and", "or", "for", "the", "a", "an", "in", "at", "to", "of", "jobs", "job"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _keywords(text: str) -> set[str]:
    return {w for w in re.split(r"\s+", (text or "").lower()) if len(w) > 2 and w not in _STOP}


class JobCacheService:
    def __init__(self) -> None:
        self._path = config.DB_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    # ── write ───────────────────────────────────────────────────────────────

    def remember(self, job: Job, role_query: str = "") -> None:
        """Insert a freshly-crawled job, or bump its hit count if already cached."""
        now = _now()
        with self._conn() as c:
            existing = c.execute(
                "SELECT hits, description FROM job_cache WHERE id = ?", (job.id,)
            ).fetchone()
            if existing:
                # Keep the longer description (detail pages sometimes come back empty).
                desc = job.description if len(job.description or "") > len(existing["description"] or "") else existing["description"]
                c.execute(
                    "UPDATE job_cache SET hits = hits + 1, last_seen_at = ?, "
                    "description = ?, role_query = ? WHERE id = ?",
                    (now, desc, role_query or "", job.id),
                )
            else:
                c.execute(
                    f"INSERT INTO job_cache ({', '.join(_COLUMNS)}) "
                    f"VALUES ({', '.join('?' for _ in _COLUMNS)})",
                    (
                        job.id, job.title, job.company, job.location, job.salary,
                        job.source, job.apply_url, job.description, role_query or "",
                        1, now, now,
                    ),
                )

    def remember_many(self, jobs: list[Job], role_query: str = "") -> None:
        for job in jobs:
            self.remember(job, role_query)

    def record_use(self, job_id: str) -> None:
        """Bump a description's hit count because a user opened/served it."""
        with self._conn() as c:
            c.execute(
                "UPDATE job_cache SET hits = hits + 1, last_seen_at = ? WHERE id = ?",
                (_now(), job_id),
            )

    # ── read ────────────────────────────────────────────────────────────────

    def popular(self, limit: int = 20, search: str | None = None) -> list[dict]:
        """Most-used cached descriptions, hottest first."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM job_cache ORDER BY hits DESC, last_seen_at DESC"
            ).fetchall()
        out = [self._row_to_dict(r) for r in rows]
        if search:
            q = search.lower()
            out = [j for j in out if q in j["title"].lower() or q in (j["company"] or "").lower()]
        return out[:limit]

    def get(self, job_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM job_cache WHERE id = ?", (job_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def fresh_jobs(self, role: str, max_age_hours: int, limit: int = 50) -> list[Job]:
        """Cached jobs matching ``role`` seen within the freshness window.

        Returned as ``Job`` objects so a search can serve them in place of a
        live crawl. Empty when nothing fresh matches — caller should then crawl.
        """
        if max_age_hours <= 0:
            return []
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()
        wanted = _keywords(role)
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM job_cache WHERE last_seen_at >= ? ORDER BY hits DESC",
                (cutoff,),
            ).fetchall()
        jobs: list[Job] = []
        for r in rows:
            d = self._row_to_dict(r)
            haystack = f"{d['title']} {d['role_query']}".lower()
            if wanted and not any(kw in haystack for kw in wanted):
                continue
            jobs.append(Job(
                id=d["id"], title=d["title"], company=d["company"],
                location=d["location"], salary=d["salary"], apply_url=d["apply_url"],
                description=d["description"], source=d["source"],
            ))
            if len(jobs) >= limit:
                break
        return jobs

    def stats(self) -> dict:
        with self._conn() as c:
            total = c.execute("SELECT COUNT(*) FROM job_cache").fetchone()[0]
            hits = c.execute("SELECT COALESCE(SUM(hits), 0) FROM job_cache").fetchone()[0]
            newest = c.execute("SELECT MAX(last_seen_at) FROM job_cache").fetchone()[0]
        return {"cached": total, "total_hits": hits, "last_cached_at": newest}

    # ── internals ────────────────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS job_cache (
                    id              TEXT PRIMARY KEY,
                    title           TEXT NOT NULL,
                    company         TEXT,
                    location        TEXT,
                    salary          TEXT DEFAULT '',
                    source          TEXT,
                    apply_url       TEXT,
                    description     TEXT,
                    role_query      TEXT,
                    hits            INTEGER DEFAULT 1,
                    first_cached_at TEXT,
                    last_seen_at    TEXT
                )"""
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_job_cache_hits ON job_cache(hits DESC)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_job_cache_seen ON job_cache(last_seen_at)")

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        return {k: row[k] for k in row.keys()}
