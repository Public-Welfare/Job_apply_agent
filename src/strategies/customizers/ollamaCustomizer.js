'use strict';

const { ResumeCustomizer } = require('../../interfaces/resumeCustomizer');
const { validateCustomizedResume } = require('../../models');
const { getLlmClient } = require('../../services/llm');

const RESPONSE_SCHEMA = `{
  "keywords_matched": [],
  "personal": {},
  "summary": "",
  "skills": { "languages": [], "frameworks": [], "tools": [], "databases": [] },
  "experience": [],
  "education": [],
  "projects": [],
  "achievements": []
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(text) {
  const match = text.trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM response');
  return JSON.parse(match[0]);
}

class OllamaCustomizer extends ResumeCustomizer {
  async customize(profile, jobTitle, company, jobDescription) {
    const prompt = this._buildPrompt(profile, jobTitle, company, jobDescription);
    const { client, model } = await getLlmClient();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        });
        const raw = response.choices[0].message.content || '';
        // validateCustomizedResume throws a clear error if the schema is wrong.
        return validateCustomizedResume(extractJson(raw));
      } catch (e) {
        if (attempt === 3) {
          throw new Error(`OllamaCustomizer failed after 3 attempts: ${e.message}`);
        }
        await sleep(attempt * 1000);
      }
    }
    // Unreachable — the loop either returns or throws on the 3rd attempt.
    throw new Error('OllamaCustomizer: exhausted retries');
  }

  _buildPrompt(profile, jobTitle, company, jobDescription) {
    return `You are a professional resume writer. Tailor the candidate's resume for this job.

JOB:
Title: ${jobTitle}
Company: ${company}
Description:
${(jobDescription || '').slice(0, 3000)}

CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

INSTRUCTIONS:
1. Extract the top 8-10 skills/keywords from the job description
2. Rewrite the summary (2-3 sentences) for this specific role and company
3. Rewrite experience bullets to naturally include JD keywords
4. Reorder skills so the most relevant appear first
5. Keep all facts truthful — rephrase only, never invent experience

Return ONLY valid JSON matching this schema (no markdown, no explanation):
${RESPONSE_SCHEMA}`;
  }
}

module.exports = { OllamaCustomizer };
