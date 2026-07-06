'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { config } = require('../config');

function buildHtml(resume) {
  const p = resume.personal;
  const s = resume.skills;
  const allSkills = [...s.languages, ...s.frameworks, ...s.tools, ...s.databases].join(' • ');

  const expHtml = resume.experience
    .map(
      (e) => `<div class="entry">
          <div class="entry-header">
            <span class="entry-title">${e.role}</span>
            <span class="entry-date">${e.duration}</span>
          </div>
          <div class="entry-sub">${e.company} — ${e.location}</div>
          <ul>${e.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
        </div>`
    )
    .join('');

  const projHtml = resume.projects
    .map(
      (pr) => `<div class="entry">
          <div class="entry-header">
            <span class="entry-title">${pr.name}</span>
            <span class="entry-date">${pr.tech.join(', ')}</span>
          </div>
          <p>${pr.description}</p>
          ${pr.link ? `<div class="entry-sub">${pr.link}</div>` : ''}
        </div>`
    )
    .join('');

  const eduHtml = resume.education
    .map(
      (e) => `<div class="entry">
          <div class="entry-header">
            <span class="entry-title">${e.institution}</span>
            <span class="entry-date">${e.year}</span>
          </div>
          <div class="entry-sub">${e.degree}${e.gpa ? ` • GPA: ${e.gpa}` : ''}</div>
          ${e.coursework ? `<div class="entry-sub"><strong>Coursework:</strong> ${e.coursework}</div>` : ''}
        </div>`
    )
    .join('');

  const achievementsHtml = resume.achievements && resume.achievements.length
    ? `<section>
          <h2>Achievements</h2>
          <ul>${resume.achievements.map((a) => `<li>${a}</li>`).join('')}</ul>
        </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 32px 40px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .contact { font-size: 10px; color: #444; margin-top: 4px; }
  .contact span { margin-right: 14px; }
  hr { border: none; border-top: 1.5px solid #1a1a1a; margin: 10px 0 8px; }
  h2 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  section { margin-bottom: 14px; }
  .entry { margin-bottom: 10px; }
  .entry-header { display: flex; justify-content: space-between; align-items: baseline; }
  .entry-title { font-weight: 600; font-size: 11.5px; }
  .entry-date { font-size: 10px; color: #555; }
  .entry-sub { font-size: 10.5px; color: #555; margin-bottom: 3px; }
  ul { padding-left: 16px; }
  ul li { margin-bottom: 2px; font-size: 10.5px; }
  p { font-size: 10.5px; color: #333; }
</style>
</head>
<body>
  <h1>${p.name}</h1>
  <div class="contact">
    <span>${p.email}</span><span>${p.phone}</span>
    <span>${p.linkedin}</span><span>${p.github}</span><span>${p.location}</span>
  </div>
  <hr />
  <section><h2>Summary</h2><p>${resume.summary}</p></section>
  <section><h2>Skills</h2><p>${allSkills}</p></section>
  <section><h2>Experience</h2>${expHtml}</section>
  <section><h2>Projects</h2>${projHtml}</section>
  <section><h2>Education</h2>${eduHtml}</section>
  ${achievementsHtml}
</body>
</html>`;
}

async function generatePdf(resume, filename) {
  fs.mkdirSync(config.RESUMES_DIR, { recursive: true });
  const outputPath = path.join(config.RESUMES_DIR, `${filename}.pdf`);
  const html = buildHtml(resume);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({ path: outputPath, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }

  return outputPath;
}

module.exports = { generatePdf, buildHtml };
