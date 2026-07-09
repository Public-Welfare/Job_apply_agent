# Job Apply Agent (Apsis)

An agentic job-hunting tool in **Node.js** with a **React dashboard**. It crawls
job boards, filters listings against your preferences, uses an LLM (local Ollama
or a free hosted provider) to tailor your resume for each match, renders the
result to a PDF, and tracks everything behind a JWT login. It can also
**re-format any resume (text or LaTeX) into a clean template**, with optional
ATS-tuned variants per job type.

The server **auto-crawls and auto-discovers once a day** in the background and
**caches job descriptions** (hit-ranked, pruned after 14 days), so the dashboard
serves popular listings instantly.

The backend is built around the **Strategy pattern** + **dependency injection**:
job sources and resume customizers are pluggable behind interfaces, so new boards
or LLMs can be added without touching the orchestration code.

---

## How it works

```
node main.js crawl
   │
   ▼
AgentOrchestrator ──(LLM tool-calling loop, max 30 turns)
   │
   ├─ search_jobs   → JobCacheService.freshJobs() ─ fresh? ─► serve from cache (no crawl)
   │                   └─ else CrawlerService → [IndeedSource, RemoteOKSource] → [Job]
   │                          └─ JobCacheService.remember()   (hit-count ranking)
   ├─ process_job   → filterByPreferences  (skip non-matches)
   │                   └─ ResumeService → OllamaCustomizer → generatePdf → resumes/*.pdf
   │                       └─ TrackerService.save(status="not_applied")
   └─ get_applications → TrackerService.getAll()
                                   │
                                   ▼
                 data/applications.db  (SQLite: applications + job_cache + roles + meta)
                                   │
                        web/server.js (Express) ──► React dashboard (web/static/dist)
                                   │
                        scheduler ──► daily auto-crawl + auto-discovery + cache prune
```

The agent **finds and tailors** roles but does **not** submit them. Processed jobs
are saved with status `not_applied` so you review the generated resume before
applying yourself.

Separately from the agent crawl, **discovery** (`node main.js discover` or the
dashboard's *Discover* button) pulls open roles straight from company ATS APIs —
Greenhouse, Lever, Ashby, Workday, plus RemoteOK — classifies them into 16 job
types, and caches them. No browser or LLM needed.

---

## Project layout

```
job-apply-agent/
├── main.js                        # CLI: crawl | discover | status | help
├── package.json                   # backend deps + build:ui / dev:ui scripts
├── Dockerfile                     # Node + LaTeX image; builds the React UI
├── .env.example                   # copy to .env
├── frontend/                      # React dashboard (Vite)
│   ├── vite.config.js             # builds into web/static/dist
│   └── src/
│       ├── App.jsx                # layout, stats, filters, crawl lifecycle hook
│       ├── JobCard.jsx            # application card + status dropdown
│       ├── modals/                # JobModal, CrawlModal, DiscoverModal, ImportModal
│       ├── api.js                 # authed fetch + download tickets
│       ├── ui.jsx                 # Modal/Icon/Toast primitives
│       └── styles.css             # the design system (dark, violet accent)
├── data/
│   ├── profile.json               # YOUR info, skills, preferences (edit this)
│   ├── companies.json             # ATS board tokens for discovery
│   └── applications.db            # SQLite: applications, job_cache, roles, meta (generated)
├── resumes/                       # generated tailored PDFs (+ imported/)
├── src/
│   ├── config.js                  # .env → Config
│   ├── models.js                  # job/profile shapes + validation
│   ├── interfaces/                # JobSource + ResumeCustomizer contracts
│   ├── strategies/
│   │   ├── sources/               # indeed, remoteok, greenhouse, lever, ashby, workday
│   │   └── customizers/           # ollamaCustomizer (LLM tailoring)
│   ├── services/
│   │   ├── crawlerService.js      # orchestrates JobSource strategies
│   │   ├── discoveryService.js    # multi-ATS fan-out + classify
│   │   ├── jobClassifier.js       # rule-based job-type taxonomy (16 types)
│   │   ├── jobCacheService.js     # hit-ranked description cache + prune()
│   │   ├── trackerService.js      # applications tracker (SQL-side filtering)
│   │   ├── roleService.js         # target roles + crawl due-times
│   │   ├── metaService.js         # key/value state in the DB (replaces JSON files)
│   │   ├── crawlRunner.js         # crawl subprocess + capped incremental log
│   │   ├── discoveryRunner.js     # in-process discovery runner
│   │   ├── scheduler.js           # daily auto-crawl + auto-discover
│   │   └── llm.js                 # Ollama-first LLM resolution + hosted fallback
│   ├── agent/                     # tool-calling orchestrator + tool defs (DI wiring)
│   ├── resume/                    # HTML→PDF generator, LaTeX template, importer, variants
│   └── utils/jobFilter.js         # role/keyword/company filtering
└── web/
    ├── server.js                  # Express composition root
    ├── auth.js                    # JWT (admin/user tiers) + 60s download tickets
    ├── httpError.js, rateLimit.js # shared middleware helpers
    ├── routes/                    # auth, llm, applications, resume, jobs, crawl
    └── static/
        ├── landing.html           # animated "Apsis" landing page (/)
        ├── login.html             # login page (/login)
        └── dist/                  # built React dashboard (/dashboard) — generated
```

---

## Setup

Requires **Node.js 20+**. Optional: [Ollama](https://ollama.com) for a free local
LLM (otherwise paste a free hosted API key in the dashboard), and
`pdflatex` ([MiKTeX](https://miktex.org)/TeX Live) for the resume-import feature.

```bash
# 1. Backend deps
npm install

# 2. Playwright browser (Indeed scraping + PDF rendering)
npx playwright install chromium

# 3. Build the React dashboard
npm run build:ui

# 4. Configure
cp .env.example .env        # then edit — change the login credentials!

# 5. (Optional) local LLM
ollama pull qwen2.5:7b && ollama serve

# 6. Edit your profile
#    data/profile.json — personal info, skills, and preferences
#    (preferences.roles / locations drive the crawl)
```

### Frontend development

`npm run dev:ui` starts Vite's dev server with hot reload (proxies `/api` to a
backend running on port 8080). `npm run build:ui` rebuilds `web/static/dist`,
which Express serves at `/dashboard`. The Docker image builds the UI itself.

### Configuration (`.env`)

| Variable             | Default                        | Purpose                                        |
| -------------------- | ------------------------------ | ---------------------------------------------- |
| `OLLAMA_URL`         | `http://localhost:11434/v1`    | OpenAI-compatible Ollama endpoint              |
| `OLLAMA_MODEL`       | `qwen2.5:7b`                   | Model for the agent + resume customizer        |
| `LLM_PROVIDER` / `LLM_API_KEY` | `groq` / —           | Hosted fallback when Ollama is down (free keys: Groq/OpenRouter/Gemini/Cerebras) |
| `CRAWLER_DELAY_MS`   | `2500`                         | Rate-limit delay between requests              |
| `MAX_JOBS_PER_RUN`   | `20`                           | Cap on jobs processed per crawl                |
| `CRAWLER_HEADFUL`    | `false`                        | `true` shows the browser while scraping        |
| `AUTO_CRAWL`         | `true`                         | Run the background daily crawl when the server is up |
| `AUTO_DISCOVER`      | `true`                         | Also run multi-source discovery on the same schedule (no browser/LLM needed) |
| `CRAWL_INTERVAL_HOURS` | `24`                         | How often the auto-crawl runs                  |
| `JOB_CACHE_TTL_HOURS`| `24`                           | How long cached descriptions are served without re-crawling (`0` = always live) |
| `JOB_CACHE_PRUNE_DAYS` | `14`                         | Prune cached jobs unseen for this many days (`0` = never) |
| `MAX_JOBS_PER_COMPANY` | `25`                         | Cap jobs pulled per company board in discovery |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | `admin` / `changeme` | Admin login — **default password blocks boot in production** |
| `USER_USERNAME` / `USER_PASSWORD` | `user` / `user` | Regular login (crawl rate-limited to once per interval) |
| `JWT_SECRET`         | *(dev default)*                | Signs JWTs — **default blocks boot in production** |
| `JWT_EXPIRE_HOURS`   | `12`                           | How long a login stays valid                   |

---

## Usage

### CLI

```bash
node main.js crawl       # agent: search jobs, tailor resumes, save to the tracker
node main.js discover    # fetch from all ATS sources, classify, cache
node main.js status      # show tracked applications in a table
```

### Web dashboard

```bash
npm start                # http://localhost:8080  (PORT env overrides)
```

- `/`          → landing page
- `/login`     → sign in (admin or user account from `.env`)
- `/dashboard` → the React app

The dashboard shows your pipeline with clickable stat filters, search/source/sort,
job-details popups, a Discover browser (filter all cached jobs by type), a New
Crawl modal (pick roles; non-admins are gated to one crawl per interval), live
crawl logs (incremental `?since=` polling), and Create Resume (paste text →
PDF + optional per-role ATS variants). While the server runs, it auto-crawls and
auto-discovers daily and prunes the cache.

### Login & downloads (JWT)

Every API route except `/api/login` requires a JWT (`Authorization: Bearer`).
Two accounts: **admin** (always may crawl) and **user** (once per interval).
`/api/login` is rate-limited (10 tries / 15 min per IP). File downloads use
**60-second single-purpose tickets** from `GET /api/download-ticket` — the
session token itself is never placed in a URL.

#### API endpoints

| Method   | Path                                | Auth | Description                          |
| -------- | ----------------------------------- | :--: | ------------------------------------ |
| `POST`   | `/api/login`                        |  —   | Exchange credentials for a JWT (rate-limited) |
| `GET`    | `/api/me`                           |  ✓   | Current user + role                  |
| `GET`    | `/api/download-ticket`              |  ✓   | 60s token for `?token=` file downloads |
| `GET`    | `/api/stats`                        |  ✓   | Counts by status (SQL)               |
| `GET`    | `/api/applications`                 |  ✓   | List (filter: status/source/search/sort, in SQL) |
| `PATCH`  | `/api/applications/{id}/status`     |  ✓   | Update status + notes                |
| `DELETE` | `/api/applications/{id}`            |  ✓   | Remove an application                |
| `GET`    | `/api/resume/{id}`                  |  ✓   | Stream the tailored PDF              |
| `POST`   | `/api/resume/import`                |  ✓   | Paste text / upload `.tex` → template PDF (+ variants via `roles: []`) |
| `GET`    | `/api/resume/import/list`           |  ✓   | List previously imported resumes     |
| `GET`    | `/api/resume/import/file/{name}`    |  ✓   | Download a generated `.tex` / `.pdf` |
| `GET`    | `/api/jobs/cached`                  |  ✓   | Most-used cached job descriptions    |
| `GET`    | `/api/jobs/cached/{id}`             |  ✓   | One cached description (counts a hit) |
| `GET`    | `/api/job-types`                    |  ✓   | Taxonomy with live counts            |
| `GET`    | `/api/jobs?types=a,b&search=`       |  ✓   | Cached jobs filtered by type, grouped |
| `POST`   | `/api/jobs/refresh`                 |  ✓   | Run discovery now                    |
| `GET`    | `/api/jobs/refresh/status`          |  ✓   | Discovery status (`?since=` incremental log) |
| `GET/POST/DELETE` | `/api/roles[/{id}]`        |  ✓   | Manage target roles                  |
| `POST`   | `/api/crawl`                        |  ✓   | Start a crawl (`roles: []` subset; 24h gate for users) |
| `GET`    | `/api/crawl/status`                 |  ✓   | Crawl status (`?since=` incremental log) |
| `GET`    | `/api/crawl/schedule`               |  ✓   | Auto-crawl config + last/next run    |
| `GET`    | `/api/llm/status`                   |  ✓   | Which AI backend is active           |
| `POST/DELETE` | `/api/llm/token`               | admin | Set/clear a hosted AI token         |

Application statuses: `not_applied`, `applied`, `interview`, `offer`, `rejected`.

---

## Extending it

**Add a new job board** — implement the `JobSource` interface and inject it:

```js
// src/strategies/sources/mySource.js
class MySource {
  get sourceName() { /* ... */ }
  async search(role, location, pages) { /* → [Job] */ }
}
```

Then add it to the list in `src/agent/tools.js` (agent crawl) or
`src/services/discoveryService.js` (discovery).

**Swap the resume LLM** — implement `ResumeCustomizer.customize(...)` and inject
it into `ResumeService` the same way.

---

## Notes & known limitations

- **Naukri** is Akamai-blocked from headless browsers; `naukriSource.js` is kept
  for reference but is not wired into the crawler.
- **Indeed** detail pages are bot-challenged, so job descriptions can come back
  empty; company/location are read from the result row instead.
- Runtime state (crawl last-run, saved AI token) lives in the DB `meta` table;
  legacy `crawl_state.json` / `llm.json` files are auto-migrated once.
- The scheduler only runs while the web server is up; the CLI is one-shot.
- The server assumes a **single instance** (in-memory crawl/discovery state).

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

**State (2026-07-09): backend redesign — routers, SQL filtering, meta table,
pruning, scheduler discovery, security hardening (JS)**

- **server.js split up.** It's now a thin composition root; route logic moved to
  `web/routes/{auth,llm,applications,resume,jobs,crawl}.js` (routers that take
  service deps), shared helpers in `web/httpError.js` + `web/rateLimit.js`, and
  background machinery in `src/services/{crawlRunner,discoveryRunner,scheduler}.js`
  with a capped-log state helper `src/services/jobState.js`.
- **SQL-side filtering** — `TrackerService.stats()` (GROUP BY) and
  `TrackerService.query({status,source,search,sort})` (WHERE/LIKE/ORDER BY)
  replace load-everything-and-filter-in-JS; `/api/resume/:id` uses `getOne`.
- **meta(key,value) table** (`src/services/metaService.js`, lazy singleton
  `getMeta()`) replaces the loose JSON state files. `crawl_state.json` and
  `llm.json` are auto-migrated on first run and renamed `*.migrated`.
  `CRAWL_STATE_PATH`/`LLM_TOKEN_PATH` only matter for that legacy migration now.
- **Cache pruning** — `JobCacheService.prune(days)`; runs at server boot and
  after every discovery. `JOB_CACHE_PRUNE_DAYS` (default 14, 0 = off).
- **Scheduler now also runs discovery** (`AUTO_DISCOVER`, default true) on the
  same `CRAWL_INTERVAL_HOURS` cadence; discovery `last_run` persists in meta.
- **Incremental status logs** — `/api/crawl/status?since=N` and
  `/api/jobs/refresh/status?since=N` return only new lines (`log_offset` is the
  cursor); logs capped at 500 lines in memory. Dashboard crawl modal appends
  instead of re-rendering. No-`since` calls still return the full capped log.
- **Crawl roles via argv** — the server spawns `node main.js crawl --roles=<json>`
  (legacy `CRAWL_ROLES` env still honoured); leftover Python env vars dropped.
- **Security**: `/api/login` rate-limited (10/15min per IP, in-memory);
  multer upload capped at 2 MB (413); with `NODE_ENV=production` the server
  **refuses to boot** on default `JWT_SECRET`/`AUTH_PASSWORD` (warns on default
  user password); **download tickets** — `GET /api/download-ticket` issues a
  60-second `typ:'dl'` JWT and `?token=` query auth now accepts ONLY those, so
  the session JWT never appears in URLs. The dashboard's `dlOpen()` helper
  fetches a ticket per download.
- **Verified**: 30-check in-process smoke suite green (login/401/403/404/413
  paths, SQL filters, ticket-vs-session query auth, since-offset logs, meta
  migration, rate-limit 429); `node main.js status` exit 0; prod-guard exit 1
  with default password.

**Not done / next**
- **Port the JS-only features to Python** (`python/` is behind: discovery,
  roles, Workday, crawl-gating, template/variants, LLM fallback, this redesign)
  — or retire the Python copy.
- Discovery `role=''` takes the first N per board (arbitrary order); consider
  ranking or a relevance filter.
- Surface roles (with due/next_due) in the dashboard UI — API is ready.
- Consider exposing `hits`/`last_seen_at` in the dashboard for a "trending roles" view.

**State (2026-07-09, pt2): React frontend + Python removed**

- **Dashboard rewritten in React 18 + Vite** (`frontend/`), replacing the
  1,600-line static `web/static/index.html` (deleted). Custom CSS design system
  (no Tailwind CDN). Components: `App.jsx` (stats/filters/crawl hook),
  `JobCard.jsx`, modals for job details / crawl / discover / create-resume.
  Build output → `web/static/dist` (gitignored); Express serves it at
  `/dashboard` (503 with instructions if unbuilt). `npm run build:ui` locally;
  the Dockerfile builds it in-image. `npm run dev:ui` = Vite dev + /api proxy.
- **UI improvements**: clickable stat tiles filter the list, sticky blurred
  header (icon-only buttons <640px), Esc/backdrop closes modals, loading
  skeletons, per-card status dropdown, live crawl log with auto-scroll +
  crawl state survives closing the modal, source filter built from data,
  responsive at 400px with no horizontal scroll.
- **Python implementation deleted** (`python/` was untracked/archived; JS is
  the only implementation now). README rewritten accordingly.
- **Verified**: 15-check Playwright suite green (auth redirect, cards, stat
  filter, popup open/Esc, search empty-state, Discover chips + row popup,
  textarea radius, crawl modal, 400px no-h-scroll, zero console errors).
