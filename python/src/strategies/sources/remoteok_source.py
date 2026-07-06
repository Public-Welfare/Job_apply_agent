import asyncio
import json
import re
import time
import urllib.request
from ...interfaces.job_source import JobSource
from ...models import Job
from ...config import config

_API_URL = "https://remoteok.com/api"
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_TAG_RE = re.compile(r"<[^>]+>")
_STOP = {"and", "or", "for", "the", "a", "an", "in", "at", "to", "of"}


def _strip_html(html: str) -> str:
    text = _TAG_RE.sub(" ", html or "")
    return re.sub(r"\s+", " ", text).strip()


class RemoteOKSource(JobSource):
    """API-based job source — same JobSource contract as the Playwright
    scrapers, but fetches clean JSON from RemoteOK's public feed. Replaces
    the Akamai-blocked Naukri scraper for remote roles."""

    @property
    def source_name(self) -> str:
        return "RemoteOK"

    async def search(self, role: str, location: str, pages: int = 2) -> list[Job]:
        # Network I/O is blocking urllib — run it off the event loop.
        raw = await asyncio.to_thread(self._fetch)
        if not raw:
            return []

        keywords = {w for w in re.split(r"\s+", role.lower()) if len(w) > 2 and w not in _STOP}

        jobs: list[Job] = []
        for item in raw:
            position = item.get("position") or item.get("title")
            if not position:
                continue  # first feed element is legal metadata

            haystack = f"{position} {' '.join(item.get('tags', []))}".lower()
            if keywords and not any(kw in haystack for kw in keywords):
                continue

            jobs.append(
                Job(
                    id=f"remoteok_{item.get('id') or item.get('slug')}",
                    title=position,
                    company=item.get("company", ""),
                    location=item.get("location") or "Remote",
                    salary=self._format_salary(item),
                    apply_url=item.get("url") or item.get("apply_url", ""),
                    description=_strip_html(item.get("description", ""))[:3000],
                    source=self.source_name,
                )
            )
            if len(jobs) >= config.MAX_JOBS:
                break

        print(f"  [{self.source_name}] {len(jobs)} matching jobs")
        return jobs

    @staticmethod
    def _format_salary(item: dict) -> str:
        lo, hi = item.get("salary_min"), item.get("salary_max")
        def k(v: int) -> str:
            return f"${v // 1000}k" if v and v >= 1000 else f"${v}"
        if lo and hi:
            return f"{k(lo)} – {k(hi)}"
        if lo:
            return f"from {k(lo)}"
        if hi:
            return f"up to {k(hi)}"
        return ""

    @staticmethod
    def _fetch() -> list[dict]:
        req = urllib.request.Request(_API_URL, headers={"User-Agent": _UA})
        # Retry a couple of times — RemoteOK occasionally drops the TLS handshake.
        for attempt in range(1, 4):
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    return json.loads(resp.read())
            except Exception as e:
                if attempt == 3:
                    print(f"  [RemoteOK] fetch error after {attempt} attempts: {e}")
                    return []
                print(f"  [RemoteOK] attempt {attempt} failed ({e}); retrying…")
                time.sleep(attempt)
        return []
