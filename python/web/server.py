from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BASE_DIR))

from src.config import config  # noqa: E402
from src.resume.latex_importer import import_resume  # noqa: E402
from src.services.job_cache_service import JobCacheService  # noqa: E402
from src.services.tracker_service import TrackerService  # noqa: E402
from web.auth import create_token, require_auth, verify_credentials  # noqa: E402

STATIC_DIR = Path(__file__).parent / "static"
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[mGKHFABCDJST]|\x1b\[[\?][0-9]*[hl]|\r")

app = FastAPI(title="Job Apply Agent Dashboard")
tracker = TrackerService()
job_cache = JobCacheService()

_crawl: dict = {"running": False, "log": [], "last_run": None}


# ── Persistent crawl state ─────────────────────────────────────────────────────
# last_run survives restarts so the daily scheduler doesn't re-crawl on every
# boot. Stored alongside the DB as a tiny JSON file.

def _load_last_run() -> Optional[str]:
    try:
        data = json.loads(config.CRAWL_STATE_PATH.read_text(encoding="utf-8"))
        return data.get("last_run")
    except (OSError, json.JSONDecodeError):
        return None


def _save_last_run(ts: str) -> None:
    config.CRAWL_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.CRAWL_STATE_PATH.write_text(json.dumps({"last_run": ts}), encoding="utf-8")


_crawl["last_run"] = _load_last_run()

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ── Request models ────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    username: str
    password: str


class StatusUpdate(BaseModel):
    status: str
    notes: str = ""


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def landing():
    return FileResponse(STATIC_DIR / "landing.html")


@app.get("/login", include_in_schema=False)
async def login_page():
    return FileResponse(STATIC_DIR / "login.html")


@app.get("/dashboard", include_in_schema=False)
async def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
async def login(body: LoginBody):
    if not verify_credentials(body.username, body.password):
        raise HTTPException(401, "Invalid username or password")
    return {"token": create_token(body.username), "username": body.username}


@app.get("/api/me")
async def me(user: str = Depends(require_auth)):
    return {"username": user}


# ── Applications ──────────────────────────────────────────────────────────────

@app.get("/api/stats")
async def get_stats(user: str = Depends(require_auth)):
    apps = tracker.get_all()
    out = {"total": len(apps), "applied": 0, "not_applied": 0, "interview": 0, "offer": 0, "rejected": 0}
    for a in apps:
        if a["status"] in out:
            out[a["status"]] += 1
    return out


@app.get("/api/applications")
async def list_applications(
    status: Optional[str] = None,
    source: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = "newest",
    user: str = Depends(require_auth),
):
    apps = tracker.get_all(filter_status=status)
    if source:
        apps = [a for a in apps if a.get("source") == source]
    if search:
        q = search.lower()
        apps = [a for a in apps if q in a["title"].lower() or q in (a.get("company") or "").lower()]
    apps.sort(key=lambda a: a["applied_at"], reverse=(sort == "newest"))
    return apps


@app.patch("/api/applications/{job_id}/status")
async def update_status(job_id: str, body: StatusUpdate, user: str = Depends(require_auth)):
    valid = {"applied", "not_applied", "interview", "offer", "rejected"}
    if body.status not in valid:
        raise HTTPException(400, f"status must be one of {sorted(valid)}")
    result = tracker.update_status(job_id, body.status, body.notes)
    if not result:
        raise HTTPException(404, "Application not found")
    return result


@app.delete("/api/applications/{job_id}")
async def delete_application(job_id: str, user: str = Depends(require_auth)):
    if not tracker.delete(job_id):
        raise HTTPException(404, "Application not found")
    return {"deleted": True}


@app.get("/api/resume/{job_id}")
async def download_resume(job_id: str, user: str = Depends(require_auth)):
    apps = tracker.get_all()
    entry = next((a for a in apps if a["id"] == job_id), None)
    if not entry:
        raise HTTPException(404, "Application not found")
    path = Path(entry["resume_path"])
    if not path.is_absolute():
        path = BASE_DIR / path
    if not path.exists():
        raise HTTPException(404, "Resume file not found on disk")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


# ── LaTeX resume import ───────────────────────────────────────────────────────

@app.post("/api/resume/import")
async def import_latex_resume(
    file: UploadFile = File(...),
    user: str = Depends(require_auth),
):
    if not (file.filename or "").lower().endswith((".tex", ".txt")):
        raise HTTPException(400, "Please upload a LaTeX (.tex) file")
    raw = (await file.read()).decode("utf-8", errors="replace")
    if not raw.strip():
        raise HTTPException(400, "Uploaded file is empty")
    try:
        result = await import_resume(raw, original_name=Path(file.filename).stem)
    except Exception as e:  # noqa: BLE001 - surface a clean error to the UI
        raise HTTPException(500, f"Import failed: {e}")
    return {
        "name": result["name"],
        "tex_url": f"/api/resume/import/file/{result['tex_file']}",
        "pdf_url": f"/api/resume/import/file/{result['pdf_file']}",
    }


@app.get("/api/resume/import/list")
async def list_imports(user: str = Depends(require_auth)):
    if not config.IMPORTS_DIR.exists():
        return []
    grouped: dict[str, dict] = {}
    for f in config.IMPORTS_DIR.iterdir():
        if f.suffix in (".tex", ".pdf"):
            grouped.setdefault(f.stem, {})[f.suffix[1:]] = f.name
    out = [
        {
            "name": stem,
            "tex_url": f"/api/resume/import/file/{files['tex']}" if "tex" in files else None,
            "pdf_url": f"/api/resume/import/file/{files['pdf']}" if "pdf" in files else None,
        }
        for stem, files in grouped.items()
    ]
    out.sort(key=lambda x: x["name"], reverse=True)
    return out


@app.get("/api/resume/import/file/{filename}")
async def get_imported_file(filename: str, user: str = Depends(require_auth)):
    safe = Path(filename).name  # block path traversal
    path = config.IMPORTS_DIR / safe
    if not path.exists():
        raise HTTPException(404, "File not found")
    media = "application/pdf" if safe.endswith(".pdf") else "application/x-tex"
    return FileResponse(path, media_type=media, filename=safe)


# ── Cached job descriptions ────────────────────────────────────────────────────
# Served from the crawl cache so the user gets popular descriptions instantly,
# with no crawl. hits = how often a posting has re-appeared / been requested.

@app.get("/api/jobs/cached")
async def cached_jobs(
    search: Optional[str] = None,
    limit: int = 20,
    user: str = Depends(require_auth),
):
    return {
        "stats": job_cache.stats(),
        "jobs": job_cache.popular(limit=max(1, min(limit, 100)), search=search),
    }


@app.get("/api/jobs/cached/{job_id}")
async def cached_job(job_id: str, user: str = Depends(require_auth)):
    entry = job_cache.get(job_id)
    if not entry:
        raise HTTPException(404, "Job not in cache")
    job_cache.record_use(job_id)  # opening a description counts as a hit
    return entry


# ── Crawl control ─────────────────────────────────────────────────────────────

@app.post("/api/crawl")
async def start_crawl(background_tasks: BackgroundTasks, user: str = Depends(require_auth)):
    if _crawl["running"]:
        raise HTTPException(409, "A crawl is already in progress")
    background_tasks.add_task(_run_crawl, True)  # manual crawl always fetches fresh
    return {"started": True}


@app.get("/api/crawl/status")
async def crawl_status(user: str = Depends(require_auth)):
    return _crawl


@app.get("/api/crawl/schedule")
async def crawl_schedule(user: str = Depends(require_auth)):
    """When the automatic daily crawl last ran and when it's next due."""
    last = _crawl["last_run"]
    next_due = None
    if last:
        try:
            next_due = (
                datetime.fromisoformat(last) + timedelta(hours=config.CRAWL_INTERVAL_HOURS)
            ).isoformat()
        except ValueError:
            next_due = None
    return {
        "auto_crawl": config.AUTO_CRAWL,
        "interval_hours": config.CRAWL_INTERVAL_HOURS,
        "cache_ttl_hours": config.JOB_CACHE_TTL_HOURS,
        "last_run": last,
        "next_run": next_due,
        "running": _crawl["running"],
    }


# ── Background crawl ──────────────────────────────────────────────────────────

async def _run_crawl(force_fresh: bool = True) -> None:
    _crawl.update(running=True, log=["Starting crawl…"])
    try:
        # Force UTF-8 in the child so Unicode prints (→, •) don't crash on Windows.
        # CRAWL_FORCE_FRESH tells the search tool to bypass the cache and hit the
        # network — that's how the daily run refreshes cached descriptions.
        env = {
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUTF8": "1",
            "CRAWL_FORCE_FRESH": "1" if force_fresh else "0",
        }
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "main.py", "crawl",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(BASE_DIR),
            env=env,
        )
        async for raw in proc.stdout:
            line = ANSI_RE.sub("", raw.decode(errors="replace")).strip()
            if line:
                _crawl["log"].append(line)
        await proc.wait()
        _crawl["log"].append(f"Done — exit code {proc.returncode}")
    except Exception as exc:
        _crawl["log"].append(f"Error: {exc}")
    finally:
        _crawl["running"] = False
        now = datetime.now(timezone.utc).isoformat()
        _crawl["last_run"] = now
        _save_last_run(now)


# ── Daily auto-crawl scheduler ─────────────────────────────────────────────────
# A single background loop: wake up periodically, and if the last crawl was more
# than CRAWL_INTERVAL_HOURS ago, kick off a fresh one. Because last_run is
# persisted, restarting the server won't force an immediate re-crawl.

async def _scheduler_loop() -> None:
    check_every = 15 * 60  # re-check every 15 minutes
    while True:
        try:
            if not _crawl["running"] and _is_crawl_due():
                _crawl["log"] = ["Auto-crawl triggered (daily schedule)…"]
                await _run_crawl(force_fresh=True)
        except Exception as exc:  # noqa: BLE001 - a scheduler must never die
            _crawl["log"].append(f"Scheduler error: {exc}")
        await asyncio.sleep(check_every)


def _is_crawl_due() -> bool:
    last = _crawl["last_run"]
    if not last:
        return True  # never crawled — do it once on first launch
    try:
        last_dt = datetime.fromisoformat(last)
    except ValueError:
        return True
    age = datetime.now(timezone.utc) - last_dt
    return age >= timedelta(hours=config.CRAWL_INTERVAL_HOURS)


@app.on_event("startup")
async def _start_scheduler() -> None:
    if config.AUTO_CRAWL:
        asyncio.create_task(_scheduler_loop())
