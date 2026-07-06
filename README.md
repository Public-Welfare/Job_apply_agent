# Job Apply Agent

An agentic job-hunting tool. It crawls job boards, filters listings against your
preferences, uses a local LLM to tailor your resume for each match, renders the
result to a PDF, and tracks everything in a small web dashboard. The dashboard is
behind JWT login and can also **re-format any LaTeX resume into a clean template**
using the local LLM.

The server **auto-crawls once a day** in the background and **caches the most-used
job descriptions**, so opening the dashboard serves popular listings instantly —
without waiting on a fresh crawl.

The codebase is built around the **Strategy pattern** + **dependency injection**:
job sources and resume customizers are pluggable behind interfaces, so new boards
or LLMs can be added without touching the orchestration code.

---

## How it works

```
main.py crawl
   │
   ▼
AgentOrchestrator ──(Ollama, tool-calling loop, max 30 turns)
   │
   ├─ search_jobs   → JobCacheService.fresh_jobs() ─ fresh? ─► serve from cache (no crawl)
   │                   └─ else CrawlerService → [IndeedSource, RemoteOKSource] → [Job]
   │                          └─ JobCacheService.remember()   (hit-count ranking)
   ├─ process_job   → filter_by_preferences  (skip non-matches)
   │                   └─ ResumeService → OllamaCustomizer → generate_pdf → resumes/*.pdf
   │                       └─ TrackerService.save(status="not_applied")
   └─ get_applications → TrackerService.get_all()
                                   │
                                   ▼
                         data/applications.db  (SQLite: applications + job_cache)
                                   │
                          web/server.py (FastAPI) ──► dashboard SPA
                                   │
                          _scheduler_loop() ──► auto-crawl every CRAWL_INTERVAL_HOURS
```

The agent **finds and tailors** roles but does **not** submit them. Processed jobs
are saved with status `not_applied` so you review the generated resume before
applying yourself.

### Auto-crawl + job-description cache

- **Daily auto-crawl** — when `web/server.py` is running with `AUTO_CRAWL=true`, a
  background loop (`_scheduler_loop`) re-crawls every `CRAWL_INTERVAL_HOURS`
  (default 24). The last run time is persisted to `data/crawl_state.json`, so
  restarting the server does **not** trigger an immediate re-crawl.
- **Description cache** — every crawled job is stored in the `job_cache` table
  (`JobCacheService`) with a `hits` counter that climbs each time the posting
  re-appears or a user opens it. `GET /api/jobs/cached` returns the hottest
  descriptions, ranked by hits.
- **Cache-first search** — a *user*-initiated search reuses cached descriptions
  when the role was crawled within `JOB_CACHE_TTL_HOURS` (no network hit). The
  *scheduled* daily crawl runs with `CRAWL_FORCE_FRESH=1` so it always bypasses
  the cache and refreshes it. Set `JOB_CACHE_TTL_HOURS=0` to always crawl live.

---

## Project layout

```
job-apply-agent/
├── main.py                       # CLI: crawl | status | help (forces UTF-8 on Windows)
├── requirements.txt
├── .env.example                  # copy to .env
├── data/
│   ├── profile.json              # YOUR info, skills, experience, preferences (edit this)
│   ├── applications.db           # SQLite: applications tracker + job_cache (generated)
│   ├── crawl_state.json          # last auto-crawl timestamp (generated at runtime)
│   └── applications.json.migrated# legacy JSON, auto-migrated into the DB once
├── resumes/                      # generated tailored PDFs
│   └── imported/                 # LaTeX resumes re-rendered via the template (.tex + .pdf)
├── src/
│   ├── config.py                 # loads .env into a Config object (incl. auth + JWT)
│   ├── models.py                 # Pydantic models + load_profile()
│   ├── interfaces/
│   │   ├── job_source.py         # JobSource ABC: source_name + search()
│   │   └── resume_customizer.py  # ResumeCustomizer ABC: customize()
│   ├── strategies/
│   │   ├── sources/
│   │   │   ├── indeed_source.py    # Playwright scraper — Indeed India
│   │   │   ├── remoteok_source.py  # API source — RemoteOK public JSON feed
│   │   │   └── naukri_source.py    # reference only (Akamai-blocked, NOT wired in)
│   │   └── customizers/
│   │       └── ollama_customizer.py# local-LLM resume tailoring
│   ├── services/
│   │   ├── crawler_service.py    # orchestrates JobSource strategies, dedupes by id
│   │   ├── resume_service.py     # customize → render PDF
│   │   ├── job_cache_service.py  # SQLite job_cache: hit-ranked descriptions + freshness
│   │   └── tracker_service.py    # SQLite persistence + JSON→DB migration
│   ├── agent/
│   │   ├── orchestrator.py       # the tool-calling agent loop
│   │   └── tools.py              # search_jobs / process_job / get_applications + DI wiring
│   ├── resume/
│   │   ├── generator.py          # HTML resume template → PDF via Playwright (per-job tailoring)
│   │   ├── latex_template.py     # render structured data → Friggeri LaTeX template (escaped)
│   │   └── latex_importer.py     # LLM extract uploaded .tex → render template → compile PDF
│   └── utils/job_filter.py       # role/keyword/company filtering
└── web/
    ├── server.py                 # FastAPI backend + background crawl runner + daily scheduler
    ├── auth.py                   # single-user JWT auth (bcrypt) + require_auth dependency
    └── static/
        ├── landing.html          # animated "Apsis" landing page (/)
        ├── login.html            # JWT login page (/login)
        └── index.html            # dashboard SPA (/dashboard, gated by login)
```

---

## Two implementations: Python and Node.js

This repo ships the **same app twice** — the original Python version and a
line-for-line **Node.js/JavaScript port**. They are behaviour-compatible and
share the same `data/applications.db`, `data/profile.json`, and `web/static/`
frontend (the UI is byte-identical — the JS server just serves the same HTML).

| Concern        | Python                    | Node.js (`.js`)              |
| -------------- | ------------------------- | ---------------------------- |
| CLI entry      | `main.py`                 | `main.js`                    |
| Web framework  | FastAPI + uvicorn         | Express                      |
| DB driver      | `sqlite3`                 | `better-sqlite3`             |
| LLM client     | `openai` (AsyncOpenAI)    | `openai` (Node SDK)          |
| Scraping / PDF | Playwright (Python)       | Playwright (Node)            |
| Auth           | PyJWT + bcrypt            | `jsonwebtoken` + `bcryptjs`  |
| File uploads   | `python-multipart`        | `multer`                     |

The JS module tree mirrors the Python one (`src/config.js`, `src/models.js`,
`src/services/*.js`, `src/strategies/**/*.js`, `src/resume/*.js`,
`src/agent/*.js`, `web/server.js`, `web/auth.js`). Filenames use `camelCase`
(`trackerService.js`) where Python used `snake_case` (`tracker_service.py`).

### Run the Node.js version

Requires **Node.js 20+**, a running [Ollama](https://ollama.com) instance, and —
for the LaTeX import feature — `pdflatex` ([MiKTeX](https://miktex.org)/TeX Live).

```bash
# 1. Install dependencies (reads package.json)
npm install

# 2. Install the Playwright browser (scraping + PDF rendering)
npx playwright install chromium

# 3. Configure (same .env as the Python version)
cp .env.example .env

# 4. Pull a model and start Ollama
ollama pull qwen2.5:7b && ollama serve

# 5. Use it
node main.js crawl          # or: npm run crawl
node main.js status         # or: npm run status
node web/server.js          # dashboard on http://localhost:8080 (or: npm start)
```

The daily auto-crawl scheduler starts automatically when `web/server.js` boots
(`AUTO_CRAWL=true`). The background crawl spawns `node main.js crawl` with
`CRAWL_FORCE_FRESH=1` so it always refreshes the cache. The `PORT` env var
overrides the default `8080`.

---

## Setup (Python version)

Requires **Python 3.10+** (uses `match` statements), a running
[Ollama](https://ollama.com) instance, and — for the LaTeX import feature — a
LaTeX distribution providing `pdflatex` ([MiKTeX](https://miktex.org) or TeX Live).

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Install the Playwright browser (used for scraping + PDF rendering)
playwright install chromium

# 3. Configure
cp .env.example .env        # then edit if needed

# 4. Pull a model and start Ollama
ollama pull qwen2.5:7b
ollama serve

# 5. Edit your profile
#    data/profile.json  — personal info, skills, experience, and preferences
#    (preferences.roles / locations drive the crawl; avoid_keywords / avoid_companies filter it out)
```

### Configuration (`.env`)

| Variable             | Default                        | Purpose                                        |
| -------------------- | ------------------------------ | ---------------------------------------------- |
| `OLLAMA_URL`         | `http://localhost:11434/v1`    | OpenAI-compatible Ollama endpoint              |
| `OLLAMA_MODEL`       | `qwen2.5:7b`                   | Model for the agent + resume customizer        |
| `CRAWLER_DELAY_MS`   | `2500`                         | Rate-limit delay between requests              |
| `MAX_JOBS_PER_RUN`   | `20`                           | Cap on jobs processed per crawl                |
| `CRAWLER_HEADFUL`    | `false`                        | `true` shows the browser while scraping        |
| `AUTO_CRAWL`         | `true`                         | Run the background daily crawl when the server is up |
| `CRAWL_INTERVAL_HOURS` | `24`                         | How often the auto-crawl runs                  |
| `JOB_CACHE_TTL_HOURS`| `24`                           | How long cached descriptions are served without re-crawling (`0` = always live) |
| `AUTH_USERNAME`      | `admin`                        | Dashboard login username — **change it**       |
| `AUTH_PASSWORD`      | `changeme`                     | Dashboard login password — **change it**       |
| `JWT_SECRET`         | `dev-insecure-secret-change-me`| Secret used to sign JWTs — set a long random string |
| `JWT_EXPIRE_HOURS`   | `12`                           | How long a login stays valid                   |
| `EMAIL_USER` / `EMAIL_APP_PASSWORD` | —               | Reserved for email-based applications          |
| `ANTHROPIC_API_KEY`  | —                              | Optional, for higher-quality resume tailoring  |

---

## Usage

### CLI

```bash
python main.py crawl     # search jobs, tailor resumes, save to the tracker
python main.py status    # show tracked applications in a table
python main.py help      # show commands and setup steps
```

`crawl` reads your target roles/locations from `data/profile.json`, runs the
agent across **Indeed India + RemoteOK**, and writes tailored PDFs to `resumes/`.

### Web dashboard

```bash
uvicorn web.server:app --port 8080
```

- `http://localhost:8080/`          → landing page
- `http://localhost:8080/login`     → sign in (uses `AUTH_USERNAME` / `AUTH_PASSWORD`)
- `http://localhost:8080/dashboard` → the app (redirects to `/login` if not signed in)

The dashboard lists every tracked application with search, source, and status
filters; lets you update status / delete entries; streams the resume PDF; and can
kick off a crawl in the background (`POST /api/crawl`) with a live log poll.

While the server is running it also **auto-crawls every 24h** (`AUTO_CRAWL`) and
caches job descriptions, so `GET /api/jobs/cached` serves the most-used listings
with no crawl. Check `GET /api/crawl/schedule` for the last/next run time.

> Tip: use a fresh port if a previous dev run left a socket bound.

### Login (JWT)

Every API route except `/api/login` requires a JWT. Sign in at `/login`; the token
is stored in the browser and sent as `Authorization: Bearer <token>` on each
request (file downloads use a `?token=` query param instead, since `<a>` links
can't set headers). It's a single user — credentials come from `.env`, the password
is bcrypt-hashed at startup. Logging in is also available via the API:

```bash
curl -X POST localhost:8080/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme"}'
# → {"token":"…","username":"admin"}
```

### Import a LaTeX resume into the template

Click **Import Resume** in the dashboard and upload your résumé as a `.tex` file.
The local LLM (qwen) **extracts** the content into structured JSON, which is then
deterministically **rendered** into the bundled Friggeri template (the one based on
`tanay_agrawal_resume.tex`) and **compiled** to PDF with `pdflatex`. You get both
the generated `.tex` and `.pdf` to download. Outputs are saved in `resumes/imported/`.

Keeping extraction (LLM) separate from rendering (code) means the model only ever
returns JSON — never raw LaTeX — so the output always compiles, with all special
characters (`& % $ # _ { } ~ ^`) safely escaped.

#### API endpoints

| Method   | Path                                | Auth | Description                          |
| -------- | ----------------------------------- | :--: | ------------------------------------ |
| `POST`   | `/api/login`                        |  —   | Exchange credentials for a JWT       |
| `GET`    | `/api/me`                           |  ✓   | Current user from the token          |
| `GET`    | `/api/stats`                        |  ✓   | Counts by status                     |
| `GET`    | `/api/applications`                 |  ✓   | List (filter: status/source/search/sort) |
| `PATCH`  | `/api/applications/{id}/status`     |  ✓   | Update status + notes                |
| `DELETE` | `/api/applications/{id}`            |  ✓   | Remove an application                |
| `GET`    | `/api/resume/{id}`                  |  ✓   | Stream the tailored PDF              |
| `POST`   | `/api/resume/import`                |  ✓   | Upload a `.tex`, get template `.tex` + PDF |
| `GET`    | `/api/resume/import/list`           |  ✓   | List previously imported resumes     |
| `GET`    | `/api/resume/import/file/{name}`    |  ✓   | Download a generated `.tex` / `.pdf` |
| `GET`    | `/api/jobs/cached`                  |  ✓   | Most-used cached job descriptions (hit-ranked) |
| `GET`    | `/api/jobs/cached/{id}`             |  ✓   | One cached description (counts as a hit) |
| `POST`   | `/api/crawl`                        |  ✓   | Start a background crawl (always fresh) |
| `GET`    | `/api/crawl/status`                 |  ✓   | Poll the running crawl's live log    |
| `GET`    | `/api/crawl/schedule`               |  ✓   | Auto-crawl config + last/next run time |

Application statuses: `not_applied`, `applied`, `interview`, `offer`, `rejected`.

---

## Extending it

**Add a new job board** — implement the `JobSource` interface and inject it:

```python
# src/strategies/sources/my_source.py
class MySource(JobSource):
    @property
    def source_name(self) -> str: ...
    async def search(self, role: str, location: str, pages: int) -> list[Job]: ...
```

Then add it to the list in `src/agent/tools.py`:

```python
_crawler = CrawlerService([IndeedSource(), RemoteOKSource(), MySource()])
```

**Swap the resume LLM** — implement `ResumeCustomizer.customize(...)` and inject it
into `ResumeService` the same way.

---

## Notes & known limitations

- **Naukri** is Akamai-blocked from headless browsers (`Access Denied` at the edge);
  `naukri_source.py` is kept for reference but is not wired into the crawler.
- **Indeed** detail pages (`viewjob`) are bot-challenged, so job descriptions can
  come back empty; company/location are read from the result row instead.
- The tracker auto-migrates a legacy `data/applications.json` into SQLite on first
  run, then renames it to `.json.migrated` so it isn't re-imported.
- On Windows, `main.py` forces UTF-8 on stdout/stderr because the default cp1252
  console crashes on Unicode characters (`→`, `•`) used throughout the output.
- The **auto-crawl scheduler** only runs while `web/server.py` is up; the CLI
  `python main.py crawl` is still a one-shot. The scheduler checks every 15 min and
  fires when `now - last_run >= CRAWL_INTERVAL_HOURS`.
- The **job cache** shares `applications.db` (table `job_cache`), separate from the
  `applications` tracker table. Deleting `data/crawl_state.json` makes the next
  server start crawl immediately.

---

## Maintenance log — pick up here next session

_Living notes so the next session knows the current state. Update as you go._

**State (2026-07-03):** Daily auto-crawl + job-description cache implemented and
smoke-tested. Login page already existed (JWT) and was left as-is.

**Done this session**
- `src/services/job_cache_service.py` — new `JobCacheService`: `job_cache` SQLite
  table, hit-count ranking (`popular`), freshness lookup (`fresh_jobs`), `stats`.
- `src/agent/tools.py` — `search_jobs` now serves from cache when fresh (unless
  `CRAWL_FORCE_FRESH=1`) and remembers every result via `remember_many`.
- `web/server.py` — `_scheduler_loop` daily auto-crawl (startup task), persistent
  `last_run` in `data/crawl_state.json`, endpoints `/api/jobs/cached`,
  `/api/jobs/cached/{id}`, `/api/crawl/schedule`; `_run_crawl(force_fresh)`.
- `src/config.py`, `.env.example` — `AUTO_CRAWL`, `CRAWL_INTERVAL_HOURS`,
  `JOB_CACHE_TTL_HOURS`, `CRAWL_STATE_PATH`.

**State (2026-07-03, later):** Full **Node.js/JavaScript port** added alongside
the Python code (see "Two implementations" above). Same DB, same `web/static`
UI, behaviour-compatible.

**Done in the JS port**
- Every Python module ported 1:1 to `.js` (config, models w/ validation, job
  filter, tracker + jobCache + crawler + resume services, RemoteOK + Indeed
  sources, Ollama customizer, generator/latexTemplate/latexImporter, agent
  tools + orchestrator, `web/auth.js`, `web/server.js` Express app, `main.js`).
- `package.json` with deps: express, better-sqlite3, jsonwebtoken, bcryptjs,
  multer, openai, playwright, dotenv. Scripts: `crawl`, `status`, `start`.
- better-sqlite3 opens the **same** `applications.db` (WAL mode) — 26 existing
  applications + `job_cache` table read fine from JS.

**Verified this session (JS)** — all green:
- `node --check` on all 20 JS files; every module `require()`s cleanly.
- `loadProfile`, `filterByPreferences` (match / no-match / avoid-keyword),
  `validateCustomizedResume` throws-on-bad-input (drives the retry).
- `renderResumeTex` — LaTeX escaping (`& _ % $ # href` URL escaping) byte-faithful
  to the Python template.
- Tracker reads 26 rows w/ `keywords_matched` parsed; JobCache stats/popular/
  freshJobs work.
- Playwright HTML→PDF generator produced a valid 34 KB PDF.
- **Express server booted in-process; 19/19 endpoint tests passed** — landing/
  login/dashboard pages, JWT login (good+bad), `/api/me|stats|applications` (+sort/
  search filters), `?token=` query auth, PDF download (`application/pdf`),
  `/api/jobs/cached`, `/api/crawl/schedule|status`, import list, 400/404/401/409.
- Live **RemoteOK** fetch → 20 jobs → cache remember (hits climb) → `freshJobs`
  cache-first hit; test rows cleaned up afterward.

**Not run here (needs external services — same limitation as Python):**
- Ollama-dependent paths: `OllamaCustomizer.customize`, `AgentOrchestrator.run`,
  LaTeX-import extraction. (Code ported faithfully; needs `ollama serve`.)
- `IndeedSource` live scrape (Indeed is bot-challenged even from Python).
- `pdflatex` compile step (`whichPdflatex` returns null if LaTeX isn't installed).
- A full `node main.js crawl` end-to-end (needs Ollama). Verify `from_cache: true`
  appears on a second search once Ollama is up.

---

**State (2026-07-04):** **Multi-source discovery + job-type dropdown** built in
the **JS version** (not yet ported to Python). Fetch open roles from many company
ATS boards, classify each into job types, and let the user filter by type in the
dashboard. Verified end-to-end (565 jobs across 4 sources).

**Done this session (JS)**
- `data/companies.json` — verified-live board tokens (Greenhouse ×13, Lever ×3,
  Ashby ×6). Every token was probed and returns data.
- New sources implementing `JobSource`: `greenhouseSource.js` (boards-api,
  `?content=true`), `leverSource.js`, `ashbySource.js`. All public JSON APIs, no
  bot wall, descriptions included in one call. `greenhouseSource` exports shared
  helpers (`loadTokens`, `fetchJson`, `cap`, `stripHtml`).
- `src/services/jobClassifier.js` — rule-based `classify(job) → JobType[]` over a
  fixed `TAXONOMY` (16 types). Internship matched with word boundaries so
  "International"/"Undergraduate" don't misfire. A job can hold multiple tags.
- `src/services/discoveryService.js` — fans out over Greenhouse/Lever/Ashby/
  RemoteOK, classifies, and `rememberMany` into the cache. (Indeed excluded here.)
- `models.js` `makeJob` gains `categories`; `jobCacheService.js` gains a
  `categories` column (+ auto-migrate), `all()`, `byTypes()`, `typeCounts()`.
- `web/server.js` — `GET /api/job-types`, `GET /api/jobs?types=a,b,c` (grouped),
  `POST /api/jobs/refresh` + `GET /api/jobs/refresh/status` (in-process discovery,
  no browser/LLM).
- `main.js` — `node main.js discover` CLI command.
- `web/static/index.html` — **"Discover" button + modal**: multi-select job-type
  chips (with counts), grouped results from all sources, per-job Apply links, and
  a "Refresh from all sources" button that polls discovery status.
- `config.js` / `.env.example` — `MAX_JOBS_PER_COMPANY` (default 25).

**Verified (JS, all green)**
- `node main.js discover` → 565 jobs (Greenhouse 325 / Lever 75 / Ashby 145 /
  RemoteOK 20), classified across every taxonomy bucket.
- Live API on a booted server: `/api/job-types` (593 cached, 16 types),
  `/api/jobs?types=backend,data-ml` (grouped), `?types=internship`, `?search=`,
  `/api/jobs/refresh` → polled to completion (565), reclassify fixed the
  "International"→internship false positive (10 → 4, 0 bad).
- Dashboard HTML serves the Discover button, modal, and JS.

**Added later (2026-07-04): the two remaining UML boxes**
- `src/services/roleService.js` — the UML `RoleService`. New `roles` table
  (role UNIQUE, location, last_crawled_at, times_crawled, active), seeded from
  `profile.json` on first use. `isDue()` / `markCrawled()` make "already crawled →
  serve cache" an explicit per-role lookup. Wired into `agent/tools.js` search_jobs
  (upsert + markCrawled after a real crawl, isDue gates cache-first). API:
  `GET/POST/DELETE /api/roles`. Verified: seed 10, CRUD, isDue flips after crawl.
- `src/strategies/sources/workdaySource.js` — the UML `WorkdaySource`. Per-tenant
  CXS POST (`/wday/cxs/{tenant}/{site}/jobs`), server-side `searchText`. **Gotcha:
  Workday caps page `limit` at 20** (25 → HTTP 400) — capped in code. Tenants in
  `companies.json` → "workday": nvidia, adobe, salesforce, workday (all verified).
  Wired into `DiscoveryService`. Verified: 80 jobs; full discovery now 645+, cache
  674 incl. NVIDIA.
- `docs/uml.html` updated: Workday + RoleService marked ✓ built; API endpoints and
  the DiscoveryService aggregation note added.
- **UML is now fully implemented in the JS version** (13→15 boxes). Structural
  note: the ATS sources are aggregated by `DiscoveryService`, not `CrawlerService`
  (which still drives the resume agent with Indeed+RemoteOK).

**Added later (2026-07-05): crawl permissions + per-crawl role selection (JS)**
- **Two auth tiers**: admin (`AUTH_USERNAME/PASSWORD`) and user
  (`USER_USERNAME/PASSWORD`, default `user`/`user`). JWT now carries a `role`
  claim; `web/auth.js` exposes `req.role` + `requireAdmin`.
- **24h crawl gate**: `POST /api/crawl` returns **403** for a non-admin when a
  crawl ran within `CRAWL_INTERVAL_HOURS`; admin always bypasses. `/api/crawl/
  schedule` now returns `role`, `may_crawl`, `ran_recently` so the UI can gate.
- **Per-crawl role selection**: `POST /api/crawl` accepts `{ roles: [] }`;
  `runCrawl` passes them via `CRAWL_ROLES` env; `main.js crawl` uses the selected
  subset (else all profile roles) and builds one search instruction per role.
- **Dashboard**: the New Crawl modal now has a **role multi-select** (checkboxes
  from `/api/roles`, "Toggle all") and shows the 24h gate notice / disables Start
  for gated users.
- Verified: admin/user/bad-login roles; `may_crawl` false for user + true for
  admin when a crawl ran <24h ago; user crawl → 403; admin crawl → 200 with
  `CRAWL_ROLES` reaching the subprocess ("Starting crawl for: …").

**Added later (2026-07-06): new resume template + paste-to-generate (JS)**
- `src/resume/latexTemplate.js` rewritten to a **navy-serif design** (centered
  small-caps name, fontawesome icon contact line, ruled navy section headers,
  two-column entries with right-aligned dates) matching the reference resume.
  New sections/fields: **Coding Profiles** (`profiles[]`), education `score`,
  experience `company/title/location`, projects `tech/demo_link`.
- `src/resume/latexImporter.js` — extractor schema + prompt updated for those
  fields; accepts LaTeX **or plain text**.
- `web/server.js` `/api/resume/import` now accepts **pasted text** (JSON `{text}`)
  as well as a file upload.
- `web/static/index.html` — the "Create Resume" modal replaced the file picker
  with a **paste textarea + Generate button** (`runImport` POSTs JSON).
- **Verified end-to-end with Ollama running**: pasted text → extract → new
  template → compiled PDF (HTTP 200, 4.2s, valid 34 KB PDF). Template also
  compiles standalone via `pdflatex` (fontawesome5 auto-installed by MiKTeX).

**Added later (2026-07-06, pt2): ATS optimisation + specialised resume inheritance (JS)**
- **ATS hardening** in `latexTemplate.js`: `\input{glyphtounicode}\pdfgentounicode=1`
  (clean text extraction), PDF metadata (`pdftitle`/`pdfauthor`), and an optional
  keyword-rich **Summary** section.
- **Inheritance model** `src/resume/resumeVariants.js`: `BaseResume` →
  `SpecializedResume extends BaseResume`. A variant deep-clones the base data and,
  for a target job type, injects that role's ATS keywords (`ROLE_KEYWORDS` per
  taxonomy id) into Skills + adds a role summary. **Same role → `tailored:false`,
  minimal change; different role → keyword row added** (e.g. AI/ML wording).
- `latexImporter.importResume(text, name, { roles })` now renders the **base +
  one specialised variant per requested job type** (each compiled to PDF).
- `/api/resume/import` accepts `roles: []` and returns `{ base, variants[] }`.
- Modal: job-type **multi-select chips** ("Also make specialised versions for")
  + the done view lists base + each specialised PDF/.tex (marking "same as base").
- **Verified end-to-end (Ollama up)**: paste → base + 2 variants in 16.3s;
  backend variant has injected "Key Skills — Backend" + "REST APIs" + Summary;
  glyphtounicode + pdftitle present; PDFs on disk. Unit-checked same-vs-different
  role behaviour.

**Added later (2026-07-06, pt3): LLM fallback — Ollama or a free hosted token (JS)**
- `src/services/llm.js` — `getLlmClient()` prefers a running **Ollama**; if it's
  unreachable, falls back to any OpenAI-compatible provider (`PROVIDERS`: groq,
  openrouter, gemini, cerebras, openai) using an API token. Token comes from env
  (`LLM_API_KEY`) or is set at runtime via the dashboard (persisted to
  `data/llm.json`, which wins). Resolution cached ~30s; throws `NO_LLM` with a
  helpful message when nothing is available.
- Refactored the 3 LLM consumers (orchestrator, ollamaCustomizer, latexImporter)
  to `await getLlmClient()` instead of constructing an Ollama client directly.
- Endpoints: `GET /api/llm/status`; `POST`/`DELETE /api/llm/token` (admin only).
- Modal: shows "AI ready · <provider> · <model>" or, when Ollama is down and no
  token is set, a **provider dropdown + key field + Save** (links to the free
  key page). This makes **hosting without a GPU/Ollama box** viable.
- `config.js` / `.env.example`: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`.
- Verified: status shows ollama when up; env/runtime token resolves to the
  provider when Ollama is down; NO_LLM when neither; admin-only token set (user→403);
  real resume import still works through the refactored client.

**Not done / next**
- **Port discovery + roles + Workday + crawl-gating + resume template/variants + LLM fallback to Python** — currently JS-only.
- **Cache pruning** still open (`job_cache` grows unbounded) — add `prune()`.
- Discovery `role=''` takes the first N per board (arbitrary order); consider
  ranking or a relevance filter.
- Wire the daily scheduler to also run discovery (currently only the agent crawl).
- Surface roles (with due/next_due) in the dashboard UI — API is ready.

**Earlier next steps (still apply)**
- **Cache pruning**: `job_cache` grows unbounded; add a `prune()` (drop entries older than N days).
- Consider exposing `hits`/`last_seen_at` in the dashboard for a "trending roles" view.
- Decide whether to retire the Python version or keep both in sync going forward.
