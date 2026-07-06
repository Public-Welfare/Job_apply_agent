from ..interfaces.job_source import JobSource
from ..models import Job


class CrawlerService:
    def __init__(self, sources: list[JobSource]) -> None:
        if not sources:
            raise ValueError("CrawlerService requires at least one JobSource")
        self._sources = sources

    async def search(self, role: str, location: str, pages: int = 2) -> list[Job]:
        seen: set[str] = set()
        results: list[Job] = []

        for source in self._sources:
            print(f"\n[Crawler] {source.source_name} → \"{role}\" in \"{location}\"")
            try:
                jobs = await source.search(role, location, pages)
                added = 0
                for job in jobs:
                    if job.id not in seen:
                        seen.add(job.id)
                        results.append(job)
                        added += 1
                print(f"[Crawler] {source.source_name}: +{added} unique jobs ({len(results)} total)")
            except Exception as e:
                print(f"[Crawler] {source.source_name} error: {e}")

        return results
