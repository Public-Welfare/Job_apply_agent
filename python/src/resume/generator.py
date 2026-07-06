from playwright.async_api import async_playwright
from ..models import CustomizedResume
from ..config import config


def _build_html(resume: CustomizedResume) -> str:
    p = resume.personal
    s = resume.skills
    all_skills = " • ".join([*s.languages, *s.frameworks, *s.tools, *s.databases])

    exp_html = "".join(
        f"""<div class="entry">
          <div class="entry-header">
            <span class="entry-title">{e.role}</span>
            <span class="entry-date">{e.duration}</span>
          </div>
          <div class="entry-sub">{e.company} — {e.location}</div>
          <ul>{"".join(f"<li>{b}</li>" for b in e.bullets)}</ul>
        </div>"""
        for e in resume.experience
    )

    proj_html = "".join(
        f"""<div class="entry">
          <div class="entry-header">
            <span class="entry-title">{pr.name}</span>
            <span class="entry-date">{", ".join(pr.tech)}</span>
          </div>
          <p>{pr.description}</p>
          {f'<div class="entry-sub">{pr.link}</div>' if pr.link else ""}
        </div>"""
        for pr in resume.projects
    )

    edu_html = "".join(
        f"""<div class="entry">
          <div class="entry-header">
            <span class="entry-title">{e.institution}</span>
            <span class="entry-date">{e.year}</span>
          </div>
          <div class="entry-sub">{e.degree}{f" • GPA: {e.gpa}" if e.gpa else ""}</div>
          {f'<div class="entry-sub"><strong>Coursework:</strong> {e.coursework}</div>' if e.coursework else ""}
        </div>"""
        for e in resume.education
    )

    achievements_html = (
        f"""<section>
          <h2>Achievements</h2>
          <ul>{"".join(f"<li>{a}</li>" for a in resume.achievements)}</ul>
        </section>"""
        if resume.achievements
        else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 32px 40px; line-height: 1.5; }}
  h1 {{ font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }}
  .contact {{ font-size: 10px; color: #444; margin-top: 4px; }}
  .contact span {{ margin-right: 14px; }}
  hr {{ border: none; border-top: 1.5px solid #1a1a1a; margin: 10px 0 8px; }}
  h2 {{ font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }}
  section {{ margin-bottom: 14px; }}
  .entry {{ margin-bottom: 10px; }}
  .entry-header {{ display: flex; justify-content: space-between; align-items: baseline; }}
  .entry-title {{ font-weight: 600; font-size: 11.5px; }}
  .entry-date {{ font-size: 10px; color: #555; }}
  .entry-sub {{ font-size: 10.5px; color: #555; margin-bottom: 3px; }}
  ul {{ padding-left: 16px; }}
  ul li {{ margin-bottom: 2px; font-size: 10.5px; }}
  p {{ font-size: 10.5px; color: #333; }}
</style>
</head>
<body>
  <h1>{p.name}</h1>
  <div class="contact">
    <span>{p.email}</span><span>{p.phone}</span>
    <span>{p.linkedin}</span><span>{p.github}</span><span>{p.location}</span>
  </div>
  <hr />
  <section><h2>Summary</h2><p>{resume.summary}</p></section>
  <section><h2>Skills</h2><p>{all_skills}</p></section>
  <section><h2>Experience</h2>{exp_html}</section>
  <section><h2>Projects</h2>{proj_html}</section>
  <section><h2>Education</h2>{edu_html}</section>
  {achievements_html}
</body>
</html>"""


async def generate_pdf(resume: CustomizedResume, filename: str) -> str:
    config.RESUMES_DIR.mkdir(parents=True, exist_ok=True)
    output_path = config.RESUMES_DIR / f"{filename}.pdf"
    html = _build_html(resume)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(html, wait_until="networkidle")
        await page.pdf(path=str(output_path), format="A4", print_background=True)
        await browser.close()

    return str(output_path)
