import asyncio
import random
from playwright.async_api import async_playwright, BrowserContext
from ...interfaces.job_source import JobSource
from ...models import Job
from ...config import config

CARD_SELECTOR = ".srp-jobtuple-wrapper, article.jobTuple, [class*='jobTuple']"
DESC_SELECTORS = [
    ".job-desc",
    "[class*='job-desc']",
    ".jobDescDetail",
    "[class*='jd-desc']",
    "[class*='JobDesc']",
]


async def _jitter() -> None:
    await asyncio.sleep(config.CRAWLER_DELAY_MS / 1000 + random.random() * 1.5)


class NaukriSource(JobSource):
    @property
    def source_name(self) -> str:
        return "Naukri"

    async def search(self, role: str, location: str, pages: int = 2) -> list[Job]:
        jobs: list[Job] = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=not config.HEADFUL)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
            )

            try:
                for page_num in range(1, pages + 1):
                    listings = await self._scrape_page(context, role, location, page_num)
                    print(f"  [{self.source_name}] Page {page_num}: {len(listings)} listings")

                    for item in listings:
                        if item.get("apply_url"):
                            item["description"] = await self._fetch_description(context, item["apply_url"])
                        jobs.append(Job(**item))
                        await _jitter()
                        if len(jobs) >= config.MAX_JOBS:
                            break

                    if len(jobs) >= config.MAX_JOBS:
                        break
                    await _jitter()
            finally:
                await browser.close()

        return jobs

    async def _scrape_page(
        self, context: BrowserContext, role: str, location: str, page_num: int
    ) -> list[dict]:
        url = self._build_url(role, location, page_num)
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_selector(CARD_SELECTOR, timeout=10_000)
            except Exception:
                print(f"  [{self.source_name}] No job cards found on page {page_num}")
                return []

            listings = await page.evaluate(
                """([cardSel, pageNum]) => {
                    return [...document.querySelectorAll(cardSel)].map((card, idx) => {
                        const titleEl = card.querySelector('a.title') ||
                                        card.querySelector('[class*="title"] a') ||
                                        card.querySelector('h2 a');
                        const companyEl = card.querySelector('a.comp-name') ||
                                          card.querySelector('[class*="comp-name"]');
                        const locationEl = card.querySelector('li.location span') ||
                                           card.querySelector('[class*="location"]');
                        const linkEl = card.querySelector('a.title') ||
                                       card.querySelector('a[href*="naukri.com/job-listings"]');
                        if (!titleEl?.textContent?.trim()) return null;
                        return {
                            id: `naukri_p${pageNum}_${idx}`,
                            title: titleEl.textContent.trim(),
                            company: companyEl?.textContent?.trim() || '',
                            location: locationEl?.textContent?.trim() || '',
                            apply_url: linkEl?.href || '',
                        };
                    }).filter(Boolean);
                }""",
                [CARD_SELECTOR, page_num],
            )

            return [{**item, "source": self.source_name} for item in listings]
        finally:
            await page.close()

    async def _fetch_description(self, context: BrowserContext, url: str) -> str:
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
            try:
                await page.wait_for_selector(", ".join(DESC_SELECTORS), timeout=8_000)
            except Exception:
                pass  # description may load late or differ; read whatever is present

            return await page.evaluate(
                """(sels) => {
                    for (const sel of sels) {
                        const el = document.querySelector(sel);
                        if (el?.innerText?.trim()) return el.innerText.trim();
                    }
                    return '';
                }""",
                DESC_SELECTORS,
            )
        except Exception:
            return ""
        finally:
            await page.close()

    def _build_url(self, role: str, location: str, page_num: int) -> str:
        role_slug = role.lower().replace(" ", "-")
        if location.lower() == "remote":
            return f"https://www.naukri.com/{role_slug}-jobs-work-from-home-{page_num}?jobAge=7"
        loc_slug = location.lower().replace(" ", "-")
        return f"https://www.naukri.com/{role_slug}-jobs-in-{loc_slug}-{page_num}?jobAge=7"
