import os

from ..config import config
from ..services.crawler_service import CrawlerService
from ..services.job_cache_service import JobCacheService
from ..services.resume_service import ResumeService
from ..services.tracker_service import TrackerService
from ..strategies.sources.indeed_source import IndeedSource
from ..strategies.sources.remoteok_source import RemoteOKSource
from ..strategies.customizers.ollama_customizer import OllamaCustomizer
from ..utils.job_filter import filter_by_preferences
from ..models import Job, load_profile

# Compose services with strategies via Dependency Injection.
# Naukri is Akamai-blocked from headless browsers, so RemoteOK (API-based)
# is wired in as the second source — both satisfy the JobSource interface.
_crawler = CrawlerService([IndeedSource(), RemoteOKSource()])
_resume_service = ResumeService(OllamaCustomizer())
_tracker = TrackerService()
_cache = JobCacheService()

# The daily scheduler launches the crawl with CRAWL_FORCE_FRESH=1 so it always
# refreshes the cache from the network. A user-initiated search leaves it unset
# and may be served straight from the cache (no network) when it's still fresh.
_FORCE_FRESH = os.getenv("CRAWL_FORCE_FRESH", "0") == "1"

# Cache full job records by id so the LLM only needs to pass back the id.
# Avoids bloating the context window with big descriptions AND prevents the
# LLM from dropping fields like source/company/location on the way back.
_job_cache: dict[str, dict] = {}

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_jobs",
            "description": "Search Indeed India and Naukri for job listings",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {"type": "string"},
                    "location": {"type": "string"},
                    "pages": {"type": "number", "description": "Pages per source (default 2)"},
                },
                "required": ["role", "location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "process_job",
            "description": "Filter, customize resume for, and track a specific job",
            "parameters": {
                "type": "object",
                "properties": {
                    "id":       {"type": "string"},
                    "title":    {"type": "string"},
                    "company":  {"type": "string"},
                    "location": {"type": "string"},
                    "apply_url":{"type": "string"},
                    "source":   {"type": "string"},
                },
                "required": ["id", "title", "company", "apply_url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_applications",
            "description": "Return all tracked job applications",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "applied | interview | rejected | offer"},
                },
            },
        },
    },
]


async def handle_tool_call(name: str, args: dict) -> dict:
    match name:
        case "search_jobs":
            role = args["role"]
            served_from_cache = False

            # Cache-first: if this role was crawled recently, reuse those
            # descriptions instead of hitting the network. The daily scheduler
            # sets CRAWL_FORCE_FRESH so it always bypasses this and refreshes.
            jobs: list[Job] = []
            if not _FORCE_FRESH and config.JOB_CACHE_TTL_HOURS > 0:
                jobs = _cache.fresh_jobs(role, config.JOB_CACHE_TTL_HOURS)
                served_from_cache = bool(jobs)

            if not jobs:
                jobs = await _crawler.search(role, args["location"], int(args.get("pages", 2)))

            # Remember every result so popular descriptions rank up and future
            # searches can be served without crawling.
            _cache.remember_many(jobs, role_query=role)

            # Cache the full record by id, then strip the description from the
            # search result so the LLM context stays small.
            for j in jobs:
                _job_cache[j.id] = j.model_dump()

            return {
                "found": len(jobs),
                "from_cache": served_from_cache,
                "jobs": [
                    {k: v for k, v in j.model_dump().items() if k != "description"}
                    for j in jobs
                ],
            }

        case "process_job":
            job_id = args.get("id")
            if not job_id:
                return {"skipped": True, "reason": "Missing job id"}

            # Prefer the cached crawl record (authoritative for source/company/
            # location/description); overlay any non-empty fields the LLM sent.
            cached = _job_cache.get(job_id, {})
            data = {**cached, **{k: v for k, v in args.items() if v}}

            if not data.get("title") or not data.get("apply_url"):
                return {"skipped": True, "reason": "Incomplete job data — skipped"}

            profile = load_profile()
            job = Job(
                id=job_id,
                title=data["title"],
                company=data.get("company", ""),
                location=data.get("location", ""),
                salary=data.get("salary", ""),
                apply_url=data["apply_url"],
                description=data.get("description", ""),
                source=data.get("source", ""),
            )

            if _tracker.is_applied(job.id):
                return {"skipped": True, "reason": "Already applied to this job"}

            passed, reason = filter_by_preferences(job, profile.preferences)
            if not passed:
                return {"skipped": True, "reason": reason}

            try:
                customized, pdf_path = await _resume_service.build_for_job(profile, job)
                # The agent finds & tailors the role but doesn't submit it —
                # save as "not_applied" so the user reviews before applying.
                _tracker.save(
                    job, pdf_path,
                    keywords_matched=customized.keywords_matched,
                    status="not_applied",
                )
                return {
                    "processed": True,
                    "keywords_matched": customized.keywords_matched,
                    "resume_path": pdf_path,
                    "apply_url": job.apply_url,
                }
            except Exception as e:
                return {"error": str(e), "job_id": job.id}

        case "get_applications":
            apps = _tracker.get_all(args.get("status"))
            return {"total": len(apps), "applications": apps}

        case _:
            return {"error": f"Unknown tool: {name}"}
