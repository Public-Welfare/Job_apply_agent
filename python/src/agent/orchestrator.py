import json
from openai import AsyncOpenAI
from ..config import config
from ..models import load_profile
from .tools import TOOL_DEFINITIONS, handle_tool_call

MAX_TURNS = 30


class AgentOrchestrator:
    def __init__(self) -> None:
        self._client = AsyncOpenAI(base_url=config.OLLAMA_URL, api_key="ollama")

    async def run(self, user_message: str, on_tool_call=None) -> tuple[str, list[dict]]:
        profile = load_profile()
        messages = [
            {"role": "system", "content": self._build_system_prompt(profile)},
            {"role": "user", "content": user_message},
        ]
        results: list[dict] = []

        for _ in range(MAX_TURNS):
            response = await self._client.chat.completions.create(
                model=config.OLLAMA_MODEL,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                temperature=0.1,
            )

            msg = response.choices[0].message
            finish = response.choices[0].finish_reason

            # Append assistant message manually to avoid SDK-specific serialization issues
            assistant_entry: dict = {"role": "assistant", "content": msg.content or ""}
            if msg.tool_calls:
                assistant_entry["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in msg.tool_calls
                ]
            messages.append(assistant_entry)

            if finish == "stop" or not msg.tool_calls:
                return msg.content or "", results

            for tc in msg.tool_calls:
                name = tc.function.name
                args = json.loads(tc.function.arguments or "{}")

                if on_tool_call:
                    on_tool_call(name, args)

                result = await handle_tool_call(name, args)
                results.append({"tool": name, "args": args, "result": result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                })

        return "Reached max turns", results

    def _build_system_prompt(self, profile) -> str:
        prefs = profile.preferences
        return f"""You are a job application agent for {profile.personal.name}.

Your job:
1. Call search_jobs for each target role and location
2. For EVERY job returned, call process_job — do not skip any
3. Report a summary of processed vs skipped

Target roles: {", ".join(prefs.roles)}
Target locations: {", ".join(prefs.locations)}
Avoid keywords: {", ".join(prefs.avoid_keywords)}

Rules:
- Process jobs one at a time using process_job
- Do not ask for clarification — just act
- Summarise results after all jobs are processed"""
