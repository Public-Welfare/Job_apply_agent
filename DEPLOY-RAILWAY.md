# Deploying to Railway

This is a Node.js app that needs **a persistent disk** (for the SQLite DB +
generated resumes) and **LaTeX** (for resume PDFs). The included `Dockerfile`
handles LaTeX; Railway provides the disk via a **Volume**. No Ollama/GPU box is
required — set a free AI token instead (see step 5).

## 1. Push the repo to GitHub
Railway deploys from a Git repo. Commit everything (the `Dockerfile`,
`.dockerignore`, and `railway.json` are already here) and push to GitHub.

## 2. Create the project
- Go to https://railway.app → **New Project → Deploy from GitHub repo** → pick this repo.
- Railway detects the `Dockerfile` and builds it. The first build is slow
  (~5–10 min) because it installs LaTeX — that's normal.

## 3. Add a Volume (persistent storage)
- In the service → **Variables/Settings → Volumes → New Volume**.
- Mount path: **`/app/storage`**
- This is where the database, generated resumes, and state will live so they
  survive redeploys.

## 4. Set environment variables
Service → **Variables** → add:

| Variable | Value | Why |
| --- | --- | --- |
| `JWT_SECRET` | *(a long random string)* | Signs login tokens — **must change** |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | your admin login | **change from defaults** |
| `USER_USERNAME` / `USER_PASSWORD` | your user login | **change from defaults** |
| `DB_PATH` | `/app/storage/applications.db` | DB on the volume |
| `CRAWL_STATE_PATH` | `/app/storage/crawl_state.json` | state on the volume |
| `LLM_TOKEN_PATH` | `/app/storage/llm.json` | saved AI token on the volume |
| `RESUMES_DIR` | `/app/storage/resumes` | generated PDFs on the volume |
| `AUTO_CRAWL` | `false` | don't auto-run the agent crawl (recommended) |

Optional — set the AI now instead of in the UI:

| Variable | Value |
| --- | --- |
| `LLM_PROVIDER` | `groq` |
| `LLM_API_KEY` | *(free key from https://console.groq.com/keys)* |

> `PORT` is injected by Railway automatically — the server reads it. Don't set it.

## 5. Generate a public URL
- Service → **Settings → Networking → Generate Domain**.
- Open the URL → you'll land on the login page.

## 6. First run
- Log in with your `AUTH_USERNAME` / `AUTH_PASSWORD`.
- If you didn't set `LLM_API_KEY`: open **Create Resume**. If Ollama isn't
  detected (it won't be on Railway), it shows a **provider + API-key** box —
  paste a free **Groq** key and Save. That's stored on the volume and used for
  all AI features.
- **Discover** works out of the box (ATS APIs, no AI needed for browsing).

## What works / what doesn't on Railway
- ✅ Dashboard, login, discovery (Greenhouse/Lever/Ashby/Workday/RemoteOK),
  job-type dropdown, resume create + specialised variants (with an AI token),
  application tracking.
- ⚠️ **Indeed crawler** needs Chromium, which this image skips to stay lean. The
  crawler still runs (RemoteOK works); Indeed just returns nothing. To enable it,
  add Playwright's browser install to the `Dockerfile`
  (`RUN npx playwright install --with-deps chromium`) — this makes the image
  much larger.

## Updating
Push to GitHub → Railway rebuilds and redeploys automatically. The volume (DB +
resumes) persists across deploys.
