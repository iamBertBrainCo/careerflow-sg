"""
Skill gaps against SkillsFuture's Skills Framework.

1. find_roles():  match your target role to official Skills Framework job roles (code, no AI).
2. role_skills(): the skills that role needs and at which proficiency level (official data).
3. main.agent_skill_gap() asks the AI only to compare YOUR profile with that official list
   and explain each gap in plain English. The list itself never comes from the AI.
4. market_signals(): what your matched job listings asked for, and their salary range (code).

Data: data/skills_framework.json.gz, built by data/build_skills_framework.py.
"""

import gzip
import json
import statistics
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from matching import normalize, title_fit

DATA_FILE = Path(__file__).parent / "data" / "skills_framework.json.gz"
SETUP_HINT = "Run `python data/build_skills_framework.py --download` in the backend folder, then restart the backend."


class FrameworkMissing(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_framework() -> dict:
    if not DATA_FILE.exists():
        raise FrameworkMissing(f"The SkillsFuture Skills Framework data isn't set up yet. {SETUP_HINT}")
    with gzip.open(DATA_FILE, "rt", encoding="utf-8") as f:
        return json.load(f)


# Common short forms people type vs the wording the Skills Framework uses
ABBREVIATIONS = {"hr": "human resource", "it": "infocomm technology", "f&b": "food and beverage", "fnb": "food and beverage",
                 "ops": "operations", "pm": "project manager", "qa": "quality assurance", "ui": "user interface",
                 "ux": "user experience", "bd": "business development", "admin": "administrative"}
LEVEL_WORDS = {"executive", "associate", "officer", "assistant", "specialist", "analyst", "coordinator", "engineer",
               "manager", "head", "director", "chief", "senior", "lead", "principal"}


def _expand(text: str) -> str:
    return " ".join(ABBREVIATIONS.get(w, w) for w in normalize(text).split())


def find_roles(target_role: str, industry: str = "", limit: int = 8) -> list[dict]:
    """Official job roles that best match the target role (and industry, if given)."""
    fw = load_framework()
    industry_norm = normalize(industry)
    target = _expand(target_role)
    target_level = set(target.split()) & LEVEL_WORDS
    scored = []
    from matching import _title_tokens
    target_tokens = _title_tokens(target)
    for r in fw["roles"]:
        title = _expand(r["role"])
        score = title_fit(target, title)
        # "HR Executive": the HR part lives in the sector ("Human Resource"), the title is "Executive, ..."
        if target_tokens and target_tokens <= set(_expand(r["sector"] + " " + r["track"]).split()):
            score = max(score, 0.6)
        if score <= 0.2:
            continue
        # Composite titles ("Accountant / Senior Accounts Executive"): split before normalising
        parts = [_expand(p) for p in r["role"].replace(",", "/").split("/")]
        matched = next((p for p in parts if p == target), None) or next((p for p in parts if p.startswith(target)), None)
        if matched == target:
            score += 0.3
        elif matched:
            score += 0.15
        # Match the level: an executive wants Executive roles, not "Head of ..." (judged on the matching part)
        if target_level:
            score += 0.15 if target_level & set((matched or title).split()) else -0.3
        if industry.strip() and (any(f" {w} " in normalize(r["sector"] + " " + r["track"]) for w in industry_norm.split() if len(w) > 2)):
            score += 0.15
        # Prefer the plain title over long composite titles ("A, B and C Manager")
        score -= min(len(r["role"]), 120) / 1200
        scored.append((score, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [{"id": r["id"], "role": r["role"], "sector": r["sector"], "track": r["track"],
             "description": r["description"], "skill_count": len(fw["needs"].get(str(r["id"]), []))}
            for _, r in scored[:limit]]


def role_details(role_id: int) -> dict:
    fw = load_framework()
    try:
        role = fw["roles"][int(role_id)]
    except (IndexError, ValueError, TypeError):
        raise KeyError("Unknown Skills Framework role")
    return role


def role_skills(role_id: int) -> list[dict]:
    """The skills a role needs, with what the required level looks like in practice."""
    fw = load_framework()
    out, seen = [], set()
    for code, level in fw["needs"].get(str(role_id), []):
        s = fw["skills"].get(code)
        if not s or s["title"] in seen:
            continue
        seen.add(s["title"])
        out.append({
            "code": code,
            "title": s["title"],
            "type": "Critical core skill" if s["type"].lower() == "ccs" else "Technical skill",
            "category": s["category"],
            "level": level,
            "description": s["description"],
            "level_description": s["proficiency"],
            "abilities": s["abilities"],
            "course_search_url": "https://www.myskillsfuture.gov.sg/content/portal/en/portal-search/portal-search.html?q="
                                 + quote_plus(s["title"]),
        })
    return out


def market_signals(profile, jobs: list) -> dict:
    """From the user's matched listings: most-requested skills they lack, and salaries."""
    from matching import skill_variants

    have = normalize(" ".join(profile.skills))
    counts: dict[str, int] = {}
    for job in jobs:
        for tag in dict.fromkeys(job.skills or []):
            if not any(f" {v} " in have for v in skill_variants(tag)):
                counts[tag] = counts.get(tag, 0) + 1
    top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:8]

    lows = [j.salary_min for j in jobs if j.salary_min]
    highs = [j.salary_max for j in jobs if j.salary_max]
    salary = {}
    if lows and highs:
        salary = {"low": int(statistics.median(lows)), "high": int(statistics.median(highs)),
                  "min": min(lows), "max": max(highs), "listings": len(highs)}
    return {"requested": [{"skill": k, "jobs": v} for k, v in top if v >= 2], "salary": salary, "job_count": len(jobs)}
