'use strict';

/**
 * Import an uploaded LaTeX resume → re-render it into the Friggeri template.
 *   1. LLM (Ollama/qwen) EXTRACTS structured data from the uploaded .tex.
 *   2. Deterministically render into our template (latexTemplate.renderResumeTex).
 *   3. Compile to PDF with pdflatex (MiKTeX / TeX Live).
 * The LLM only ever returns JSON — never raw LaTeX — so output always compiles.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config } = require('../config');
const { renderResumeTex } = require('./latexTemplate');
const { buildVariants } = require('./resumeVariants');
const { getLlmClient } = require('../services/llm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function whichPdflatex() {
  const exts = process.platform === 'win32' ? ['.exe', '.bat', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `pdflatex${ext}`);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

const PDFLATEX = whichPdflatex();

const SCHEMA = `{
  "name": "",
  "location": "",
  "email": "",
  "phone": "",
  "links": [{ "label": "Portfolio", "url": "" }, { "label": "LinkedIn", "url": "" }, { "label": "GitHub", "url": "" }],
  "education": [{ "institution": "", "degree": "", "date": "", "score": "", "coursework": "" }],
  "experience": [{ "company": "", "title": "", "location": "", "date": "", "bullets": [] }],
  "projects": [{ "name": "", "subtitle": "", "tech": "", "link": "", "demo_link": "", "bullets": [] }],
  "skills": [{ "category": "Languages", "items": "Python, C++" }],
  "profiles": [{ "label": "Codeforces", "detail": "Expert (1621)", "link": "" }],
  "achievements": [{ "label": "", "detail": "" }]
}`;

function buildExtractPrompt(source) {
  return `You are a resume parser. The user pasted their resume (either LaTeX source or plain text).
Extract every detail into the JSON schema below. Do NOT invent or omit anything.

RULES:
- Strip any LaTeX/markup; return clean plain text (e.g. "\\textbf{30\\%}" -> "30%").
- "links" = header profile links (Portfolio/website, LinkedIn, GitHub) with their URLs.
- "education": each entry has institution, degree, date range, and "score" (the CGPA/grade/percentage, e.g. "Grade: 9.16" or "Percentage: 96.2%"). "coursework" only if listed under the school.
- "experience": "company" is the organisation, "title" is the role, "location" (e.g. Remote), "date" is the range, and one string per bullet.
- "projects": "subtitle" is the short tagline, "tech" is the comma-separated stack, "link" is the code/repo URL, "demo_link" is the live/deployed URL, and one string per bullet.
- "skills": group by the category labels used (Coursework, Languages, Skills, Frameworks/Libraries/Databases, …); "items" is the comma-separated list.
- "profiles" = competitive-coding profiles (Codeforces, LeetCode, InterviewBit, …): "label" is the platform, "detail" is the rating/score (e.g. "Expert (1621)"), "link" is the profile URL if present.
- "achievements": if an item has a "label: detail" shape keep both, else put the whole line in "detail".
- Use empty string "" or empty list [] for anything genuinely absent.

RESUME SOURCE:
${source.slice(0, 9000)}

Return ONLY valid JSON matching this schema (no markdown fences, no commentary):
${SCHEMA}`;
}

function extractJson(text) {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM response');
  return JSON.parse(match[0]);
}

async function extractStructured(texSource) {
  const prompt = buildExtractPrompt(texSource);
  const { client, model } = await getLlmClient();
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      });
      return extractJson(resp.choices[0].message.content || '');
    } catch (e) {
      lastErr = e;
      await sleep(attempt * 1000);
    }
  }
  throw new Error(`Resume extraction failed after 3 attempts: ${lastErr && lastErr.message}`);
}

function slug(name) {
  const s = String(name || 'resume')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return (s || 'resume').slice(0, 40);
}

function compilePdf(texPath) {
  return new Promise((resolve, reject) => {
    if (!PDFLATEX) {
      reject(
        new Error(
          'pdflatex was not found on PATH. Install a LaTeX distribution ' +
            '(MiKTeX or TeX Live), or download the generated .tex and compile it yourself.'
        )
      );
      return;
    }
    const outDir = path.dirname(texPath);
    const proc = spawn(
      PDFLATEX,
      ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${outDir}`, texPath],
      { cwd: outDir }
    );
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (out += d.toString()));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      const pdfPath = texPath.replace(/\.tex$/, '.pdf');
      if (code !== 0 || !fs.existsSync(pdfPath)) {
        const logTail = out.slice(-1800);
        reject(new Error(`pdflatex failed (exit ${code}):\n${logTail}`));
        return;
      }
      // Tidy the intermediate files pdflatex leaves behind.
      for (const ext of ['.aux', '.log', '.out']) {
        const aux = texPath.replace(/\.tex$/, ext);
        try {
          if (fs.existsSync(aux)) fs.unlinkSync(aux);
        } catch {
          /* ignore */
        }
      }
      resolve(pdfPath);
    });
  });
}

async function renderAndCompile(data, baseName) {
  const texPath = path.join(config.IMPORTS_DIR, `${baseName}.tex`);
  fs.writeFileSync(texPath, renderResumeTex(data), 'utf-8');
  const pdfPath = await compilePdf(texPath);
  return { tex_file: path.basename(texPath), pdf_file: path.basename(pdfPath) };
}

/**
 * Extract the pasted resume, render the base, and — via the inheritance model —
 * render a specialised variant for each requested job type.
 * @param {object} [options] { roles: string[] } job-type ids to specialise for.
 */
async function importResume(texSource, originalName = '', options = {}) {
  const data = await extractStructured(texSource);
  const roles = Array.isArray(options.roles) ? options.roles : [];

  fs.mkdirSync(config.IMPORTS_DIR, { recursive: true });
  const stamp = String(Math.floor(Date.now() / 1000)).slice(-6);
  const baseSlug = `${slug(data.name || originalName)}_${stamp}`;

  // Base resume (the parent all variants inherit from).
  const base = await renderAndCompile(data, baseSlug);

  // Specialised variants (inherit base text, boost role keywords).
  const variants = [];
  for (const v of buildVariants(data, roles)) {
    const files = await renderAndCompile(v.data, `${baseSlug}_${v.jobType}`);
    variants.push({ jobType: v.jobType, label: v.label, tailored: v.tailored, ...files });
  }

  return {
    name: data.name || originalName || baseSlug,
    base,
    variants,
    data,
  };
}

module.exports = { importResume, extractStructured, compilePdf, renderResumeTex, renderAndCompile };
