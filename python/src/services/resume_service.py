import re
from ..interfaces.resume_customizer import ResumeCustomizer
from ..models import UserProfile, Job, CustomizedResume
from ..resume.generator import generate_pdf


class ResumeService:
    def __init__(self, customizer: ResumeCustomizer) -> None:
        self._customizer = customizer

    async def build_for_job(self, profile: UserProfile, job: Job) -> tuple[CustomizedResume, str]:
        print(f"[Resume] Customizing for {job.company} — {job.title}")
        customized = await self._customizer.customize(
            profile, job.title, job.company, job.description
        )
        slug = re.sub(r"[^a-z0-9_]", "_", f"{job.company}_{job.title}_{job.id}", flags=re.I)
        slug = re.sub(r"_+", "_", slug)[:60]
        pdf_path = await generate_pdf(customized, slug)
        print(f"[Resume] PDF saved → {pdf_path}")
        return customized, pdf_path
