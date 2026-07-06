import json
import sqlite3
from datetime import datetime, timezone
from ..config import config
from ..models import Job, ApplicationEntry

_COLUMNS = [
    "id", "title", "company", "location", "salary", "source", "apply_url",
    "resume_path", "description", "keywords_matched",
    "status", "applied_at", "updated_at", "notes",
]


class TrackerService:
    """SQLite-backed application tracker. Public interface is unchanged from
    the previous JSON implementation, so callers (web server, agent tools)
    need no changes — single responsibility: persist & query applications."""

    def __init__(self) -> None:
        self._path = config.DB_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._migrate_from_json()

    # ── public API ────────────────────────────────────────────────────────────

    def is_applied(self, job_id: str) -> bool:
        with self._conn() as c:
            row = c.execute("SELECT 1 FROM applications WHERE id = ?", (job_id,)).fetchone()
            return row is not None

    def save(
        self,
        job: Job,
        resume_path: str,
        keywords_matched: list[str] | None = None,
        status: str = "applied",
    ) -> None:
        if self.is_applied(job.id):
            return
        now = datetime.now(timezone.utc).isoformat()
        entry = ApplicationEntry(
            id=job.id,
            title=job.title,
            company=job.company,
            location=job.location,
            salary=job.salary,
            source=job.source,
            apply_url=job.apply_url,
            resume_path=resume_path,
            description=job.description,
            keywords_matched=keywords_matched or [],
            status=status,
            applied_at=now,
            updated_at=now,
        )
        self._insert(entry.model_dump())

    def update_status(self, job_id: str, status: str, notes: str = "") -> dict | None:
        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as c:
            cur = c.execute(
                "UPDATE applications SET status = ?, notes = ?, updated_at = ? WHERE id = ?",
                (status, notes, now, job_id),
            )
            if cur.rowcount == 0:
                return None
        return self.get_one(job_id)

    def delete(self, job_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM applications WHERE id = ?", (job_id,))
            return cur.rowcount > 0

    def get_one(self, job_id: str) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM applications WHERE id = ?", (job_id,)).fetchone()
            return self._row_to_dict(row) if row else None

    def get_all(self, filter_status: str | None = None) -> list[dict]:
        with self._conn() as c:
            if filter_status:
                rows = c.execute(
                    "SELECT * FROM applications WHERE status = ? ORDER BY applied_at",
                    (filter_status,),
                ).fetchall()
            else:
                rows = c.execute("SELECT * FROM applications ORDER BY applied_at").fetchall()
            return [self._row_to_dict(r) for r in rows]

    # ── internals ─────────────────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS applications (
                    id               TEXT PRIMARY KEY,
                    title            TEXT NOT NULL,
                    company          TEXT,
                    location         TEXT,
                    salary           TEXT DEFAULT '',
                    source           TEXT,
                    apply_url        TEXT,
                    resume_path      TEXT,
                    description      TEXT,
                    keywords_matched TEXT,
                    status           TEXT DEFAULT 'applied',
                    applied_at       TEXT,
                    updated_at       TEXT,
                    notes            TEXT DEFAULT ''
                )"""
            )
            # Evolve older DBs that predate a column (e.g. salary).
            existing = {r[1] for r in c.execute("PRAGMA table_info(applications)")}
            for col in _COLUMNS:
                if col not in existing:
                    c.execute(f"ALTER TABLE applications ADD COLUMN {col} TEXT DEFAULT ''")

    def _insert(self, data: dict) -> None:
        data = {**data, "keywords_matched": json.dumps(data.get("keywords_matched", []))}
        placeholders = ", ".join("?" for _ in _COLUMNS)
        with self._conn() as c:
            c.execute(
                f"INSERT OR REPLACE INTO applications ({', '.join(_COLUMNS)}) VALUES ({placeholders})",
                tuple(data.get(col) for col in _COLUMNS),
            )

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        raw = d.get("keywords_matched")
        try:
            d["keywords_matched"] = json.loads(raw) if raw else []
        except (json.JSONDecodeError, TypeError):
            d["keywords_matched"] = []
        return d

    def _migrate_from_json(self) -> None:
        """One-time import of the legacy applications.json into SQLite."""
        legacy = config.APPLICATIONS_PATH
        if not legacy.exists():
            return
        with self._conn() as c:
            count = c.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
        if count > 0:
            return  # DB already populated; don't re-import
        try:
            apps = json.loads(legacy.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        for a in apps:
            a.setdefault("description", "")
            a.setdefault("keywords_matched", [])
            a.setdefault("notes", "")
            self._insert({col: a.get(col) for col in _COLUMNS})
        # Keep the JSON as a backup but rename so we don't re-migrate.
        legacy.rename(legacy.with_suffix(".json.migrated"))
        print(f"[Tracker] Migrated {len(apps)} applications from JSON -> SQLite")
