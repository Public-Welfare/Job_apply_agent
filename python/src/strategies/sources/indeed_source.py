import asyncio
import random
from playwright.async_api import async_playwright, BrowserContext
from ...interfaces.job_source import JobSource
from ...models import Job
from ...config import config

TITLE_SELECTORS = [
    "h2 a span[title]",
    "h2.jobTitle a span",
    "[class*='jobTitle'] a span",
    "h2 a span",
    "h2 a",
]
# NOTE: company & location live in the result ROW (.job_seen_beacon / .cardOutline),
# NOT inside the [data-jk] card element — selectors must be scoped to the row.
COMPANY_SELECTORS = [
    "[data-testid='company-name']",
    "span[data-testid='company-name']",
    "[class*='companyName']",
]
LOCATION_SELECTORS = [
    "[data-testid='text-location']",
    "[data-testid='company-location']",
    "[class*='companyLocation']",
]
SALARY_SELECTORS = [
    "[data-testid='attribute_snippet_testid']",
    ".salary-snippet-container",
    "[class*='salary-snippet']",
    "[class*='salaryOnly']",
    "[class*='estimated-salary']",
]
DESC_SELECTORS = [
    "#jobDescriptionText",
    ".jobsearch-jobDescriptionText",
    "[class*='JobDescription']",
    "[class*='jobdescription']",
]


async def _jitter() -> None:
    await asyncio.sleep(config.CRAWLER_DELAY_MS / 1000 + random.random() * 1.5)


class IndeedSource(JobSource):
    @property
    def source_name(self) -> str:
        return "Indeed India"

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
                viewport={"width": 1366, "height": 768},
            )

            try:
                for page_num in range(pages):
                    listings = await self._scrape_page(context, role, location, page_num)
                    print(f"  [{self.source_name}] Page {page_num + 1}: {len(listings)} listings")

                    for item in listings:
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
        start = page_num * 10
        url = (
            f"https://in.indeed.com/jobs"
            f"?q={role.replace(' ', '+')}&l={location.replace(' ', '+')}"
            f"&start={start}&sort=date"
        )

        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)

            title = await page.title()
            if any(w in title.lower() for w in ("captcha", "verify", "robot", "unusual")):
                print(f"  [{self.source_name}] Blocked — page title: '{title}'")
                return []

            try:
                await page.wait_for_selector("[data-jk]", timeout=10_000)
            except Exception:
                print(f"  [{self.source_name}] No job cards found. Title: '{title}'")
                return []

            listings = await page.evaluate(
                """([titleSels, companySels, locationSels, salarySels]) => {
                    function first(root, sels) {
                        for (const sel of sels) {
                            const el = root.querySelector(sel);
                            if (el?.textContent?.trim()) return el;
                        }
                        return null;
                    }
                    // Extract only the clean money pattern — snippet containers can
                    // also hold job type ("Full-time") or injected <style> CSS text.
                    const PAY = /[₹$£]\\s?[\\d,]+(?:\\.\\d+)?(?:\\s*(?:[-–]|to)\\s*[₹$£]?\\s?[\\d,]+(?:\\.\\d+)?)?(?:\\s*(?:a|per)\\s+(?:year|month|week|day|hour|annum))?|[\\d.]+\\s*-?\\s*[\\d.]*\\s*LPA/i;
                    function findSalary(root, sels) {
                        for (const sel of sels) {
                            for (const el of root.querySelectorAll(sel)) {
                                if (el.querySelector('style')) continue;   // skip CSS-bearing nodes
                                const t = el.textContent || '';
                                const m = t.match(PAY);
                                if (m) return m[0].trim();
                            }
                        }
                        return '';
                    }
                    return [...document.querySelectorAll('[data-jk]')].reduce((acc, card) => {
                        const id = card.getAttribute('data-jk');
                        if (!id) return acc;
                        // Climb to the full result row — company & location are siblings
                        // of the card, not descendants of [data-jk].
                        const row = card.closest('.job_seen_beacon')
                                 || card.closest('.cardOutline')
                                 || card.closest('.slider_item')
                                 || card.parentElement
                                 || card;
                        const titleEl = first(row, titleSels);
                        const title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || '';
                        if (!title) return acc;
                        acc.push({
                            id,
                            title,
                            company: first(row, companySels)?.textContent?.trim() || '',
                            location: first(row, locationSels)?.textContent?.trim() || '',
                            salary: findSalary(row, salarySels),
                        });
                        return acc;
                    }, []);
                }""",
                [TITLE_SELECTORS, COMPANY_SELECTORS, LOCATION_SELECTORS, SALARY_SELECTORS],
            )

            return [
                {**item, "apply_url": f"https://in.indeed.com/viewjob?jk={item['id']}", "source": self.source_name}
                for item in listings
            ]
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
