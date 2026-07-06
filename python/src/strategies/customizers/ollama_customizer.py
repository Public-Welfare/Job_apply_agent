import json
import re
from openai import AsyncOpenAI
from ...interfaces.resume_customizer import ResumeCustomizer
from ...models import UserProfile, CustomizedResume
from ...config import config

_RESPONSE_SCHEMA = """{
  "keywords_matched": [],
  "personal": {},
  "summary": "",
  "skills": { "languages": [], "frameworks": [], "tools": [], "databases": [] },
  "experience": [],
  "education": [],
  "projects": [],
  "achievements": []
}"""


class OllamaCustomizer(ResumeCustomizer):
    def __init__(self) -> None:
        self._client = AsyncOpenAI(base_url=config.OLLAMA_URL, api_key="ollama")

    async def customize(
        self,
        profile: UserProfile,
        job_title: str,
        company: str,
        job_description: str,
    ) -> CustomizedResume:
        prompt = self._build_prompt(profile, job_title, company, job_description)

        for attempt in range(1, 4):
            try:
                response = await self._client.chat.completions.create(
                    model=config.OLLAMA_MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                )
                raw = response.choices[0].message.content or ""
                # Pydantic validates and raises a clear error if the schema is wrong
                return CustomizedResume.model_validate(self._extract_json(raw))
            except Exception as e:
                if attempt == 3:
                    raise RuntimeError(f"OllamaCustomizer failed after 3 attempts: {e}") from e
                import asyncio
                await asyncio.sleep(attempt)

    def _build_prompt(
        self, profile: UserProfile, job_title: str, company: str, job_description: str
    ) -> str:
        return f"""You are a professional resume writer. Tailor the candidate's resume for this job.

JOB:
Title: {job_title}
Company: {company}
Description:
{job_description[:3000]}

CANDIDATE PROFILE:
{profile.model_dump_json(indent=2)}

INSTRUCTIONS:
1. Extract the top 8-10 skills/keywords from the job description
2. Rewrite the summary (2-3 sentences) for this specific role and company
3. Rewrite experience bullets to naturally include JD keywords
4. Reorder skills so the most relevant appear first
5. Keep all facts truthful — rephrase only, never invent experience

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{_RESPONSE_SCHEMA}"""

    @staticmethod
    def _extract_json(text: str) -> dict:
        match = re.search(r"\{[\s\S]*\}", text.strip())
        if not match:
            raise ValueError("No JSON object found in LLM response")
        return json.loads(match.group())
