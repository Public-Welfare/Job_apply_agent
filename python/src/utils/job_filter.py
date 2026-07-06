import re
from ..models import Job, UserPreferences

_STOP = {"and", "or", "for", "the", "a", "an", "in", "at", "to", "of", "as", "by"}


def _words(text: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9\s]", " ", text.lower()).split())


def filter_by_preferences(job: Job, prefs: UserPreferences) -> tuple[bool, str]:
    title = job.title.lower()
    title_words = _words(title)
    desc = job.description.lower()
    company = job.company.lower()

    # Primary: exact substring match (e.g. "Software Engineer" in title)
    exact = any(r.lower() in title for r in prefs.roles)

    # Fallback: any significant keyword from any role appears in the title.
    # Handles variations like "SDE Intern" → keyword "intern" matches
    # "Software Developer Intern", or "Full Stack" matches "Full Stack Engineer".
    role_keywords = set()
    for role in prefs.roles:
        role_keywords |= _words(role) - _STOP
    keyword_hit = any(kw in title_words for kw in role_keywords if len(kw) > 3)

    if not (exact or keyword_hit):
        return False, f'"{job.title}" doesn\'t match target roles'

    for kw in prefs.avoid_keywords:
        if kw.lower() in desc:
            return False, f'Contains avoided keyword: "{kw}"'

    for co in prefs.avoid_companies:
        if co.lower() in company:
            return False, f'Avoided company: "{co}"'

    return True, "OK"
