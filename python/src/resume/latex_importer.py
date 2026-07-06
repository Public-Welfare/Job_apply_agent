"""Import an uploaded LaTeX resume → re-render it into the Friggeri template.

Pipeline:
    1. Ask the local LLM (Ollama / qwen) to EXTRACT structured data from the
       user's uploaded ``.tex`` source.
    2. Deterministically render that data into our template (proper escaping,
       guaranteed-compilable LaTeX) via ``latex_template.render_resume_tex``.
    3. Compile to PDF with ``pdflatex`` (MiKTeX / TeX Live).

Keeping extraction (LLM) and rendering (code) separate means the LLM never has
to produce valid LaTeX — it only returns JSON — so the output always compiles.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import time
from pathlib import Path

from openai import AsyncOpenAI

from ..config import config
from .latex_template import render_resume_tex

_client = AsyncOpenAI(base_url=config.OLLAMA_URL, api_key="ollama")
_PDFLATEX = shutil.which("pdflatex")

_SCHEMA = """{
  "name": "",
  "location": "",
  "email": "",
  "phone": "",
  "links": [{ "label": "GitHub", "url": "" }],
  "education": [{ "degree": "", "institution": "", "date": "", "coursework": "" }],
  "skills": [{ "category": "Programming Languages", "items": "Python, C++" }],
  "projects": [{ "name": "", "subtitle": "", "role": "", "link": "", "bullets": [] }],
  "experience": [{ "title": "", "company": "", "date": "", "bullets": [] }],
  "achievements": [{ "label": "", "detail": "" }]
}"""

_EXTRACT_PROMPT = """You are a resume parser. The user pasted the LaTeX (.tex) source of their resume.
Extract every detail into the JSON schema below. Do NOT invent or omit anything.

RULES:
- Strip all LaTeX commands/markup; return clean plain text (e.g. "\\textbf{{30\\%}}" -> "30%").
- "links" = profile links from the header (GitHub, LinkedIn, Codeforces, portfolio, etc.) with their URLs.
- "skills" = group by the category labels used in the resume; "items" is the comma-separated list.
- "projects"/"experience" bullets: one string per bullet point, full text preserved.
- "achievements": if an item has a "label: detail" shape keep both, else put the whole line in "detail".
- Use empty string "" or empty list [] for anything genuinely absent.

LATEX RESUME SOURCE:
{source}

Return ONLY valid JSON matching this schema (no markdown fences, no commentary):
{schema}"""


def _extract_json(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text.strip())
    if not match:
        raise ValueError("No JSON object found in LLM response")
    return json.loads(match.group())


async def extract_structured(tex_source: str) -> dict:
    """Run the LLM extraction with a few retries, returning a plain dict."""
    prompt = _EXTRACT_PROMPT.format(source=tex_source[:9000], schema=_SCHEMA)
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            resp = await _client.chat.completions.create(
                model=config.OLLAMA_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            return _extract_json(resp.choices[0].message.content or "")
        except Exception as e:  # noqa: BLE001 - retry on any parse/transport error
            last_err = e
            await asyncio.sleep(attempt)
    raise RuntimeError(f"Resume extraction failed after 3 attempts: {last_err}")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", (name or "resume").strip()).strip("_").lower()
    return (s or "resume")[:40]


async def compile_pdf(tex_path: Path) -> Path:
    """Compile a .tex file to PDF in place. Raises with the log tail on failure."""
    if not _PDFLATEX:
        raise RuntimeError(
            "pdflatex was not found on PATH. Install a LaTeX distribution "
            "(MiKTeX or TeX Live), or download the generated .tex and compile it yourself."
        )
    out_dir = tex_path.parent
    proc = await asyncio.create_subprocess_exec(
        _PDFLATEX,
        "-interaction=nonstopmode",
        "-halt-on-error",
        f"-output-directory={out_dir}",
        str(tex_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=str(out_dir),
    )
    stdout, _ = await proc.communicate()
    pdf_path = tex_path.with_suffix(".pdf")

    if proc.returncode != 0 or not pdf_path.exists():
        log_tail = stdout.decode(errors="replace")[-1800:]
        raise RuntimeError(f"pdflatex failed (exit {proc.returncode}):\n{log_tail}")

    # Tidy the intermediate files pdflatex leaves behind.
    for ext in (".aux", ".log", ".out"):
        aux = tex_path.with_suffix(ext)
        if aux.exists():
            try:
                aux.unlink()
            except OSError:
                pass
    return pdf_path


async def import_resume(tex_source: str, original_name: str = "") -> dict:
    """Full pipeline: extract → render template → compile PDF.

    Returns the structured data plus the generated ``.tex`` and ``.pdf`` filenames.
    """
    data = await extract_structured(tex_source)
    rendered = render_resume_tex(data)

    config.IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = str(int(time.time()))[-6:]
    base = f"{_slug(data.get('name') or original_name)}_{stamp}"
    tex_path = config.IMPORTS_DIR / f"{base}.tex"
    tex_path.write_text(rendered, encoding="utf-8")

    pdf_path = await compile_pdf(tex_path)

    return {
        "name": data.get("name") or original_name or base,
        "tex_file": tex_path.name,
        "pdf_file": pdf_path.name,
        "data": data,
    }
