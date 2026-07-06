'use strict';

const { loadProfile } = require('../models');
const { getLlmClient } = require('../services/llm');
const { TOOL_DEFINITIONS, handleToolCall } = require('./tools');

const MAX_TURNS = 30;

class AgentOrchestrator {
  /**
   * @returns {Promise<[string, Array]>} [summaryText, results]
   */
  async run(userMessage, onToolCall = null) {
    const { client, model } = await getLlmClient();
    const profile = loadProfile();
    const messages = [
      { role: 'system', content: this._buildSystemPrompt(profile) },
      { role: 'user', content: userMessage },
    ];
    const results = [];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.1,
      });

      const msg = response.choices[0].message;
      const finish = response.choices[0].finish_reason;

      // Append assistant message manually to avoid SDK-specific serialization issues.
      const assistantEntry = { role: 'assistant', content: msg.content || '' };
      if (msg.tool_calls && msg.tool_calls.length) {
        assistantEntry.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      messages.push(assistantEntry);

      if (finish === 'stop' || !msg.tool_calls || !msg.tool_calls.length) {
        return [msg.content || '', results];
      }

      for (const tc of msg.tool_calls) {
        const name = tc.function.name;
        let args;
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          args = {};
        }

        if (onToolCall) onToolCall(name, args);

        const result = await handleToolCall(name, args);
        results.push({ tool: name, args, result });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
    }

    return ['Reached max turns', results];
  }

  _buildSystemPrompt(profile) {
    const prefs = profile.preferences;
    return `You are a job application agent for ${profile.personal.name}.

Your job:
1. Call search_jobs for each target role and location
2. For EVERY job returned, call process_job — do not skip any
3. Report a summary of processed vs skipped

Target roles: ${prefs.roles.join(', ')}
Target locations: ${prefs.locations.join(', ')}
Avoid keywords: ${prefs.avoid_keywords.join(', ')}

Rules:
- Process jobs one at a time using process_job
- Do not ask for clarification — just act
- Summarise results after all jobs are processed`;
  }
}

module.exports = { AgentOrchestrator };
