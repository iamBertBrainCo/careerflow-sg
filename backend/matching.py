"""
Job ranking, step 1: score every job in plain code. No AI, so it is instant,
free, repeatable and explainable.

How a job is scored (0-100):
    Title fit       35%  How many words of your target role appear in the job title
    Skills fit      35%  How many of your skills the job asks for (tags or description)
    Experience fit  20%  Your years of experience vs the job's minimum
    Salary fit      10%  The job's top salary vs your minimum (neutral if either is unknown)

Step 2 (in main.py, agent_match_jobs) asks the AI to re-rank only the best few
and explain each one, which keeps the AI call small enough for free API tiers.
"""

import html
import re

WEIGHTS = {"title": 0.35, "skills": 0.35, "experience": 0.20, "salary": 0.10}

# Words that carry no meaning when comparing job titles
TITLE_STOPWORDS = {
    "and", "or", "of", "the", "a", "an", "in", "for", "to", "with", "at", "on",
    "senior", "junior", "sr", "jr", "assistant", "associate", "lead", "head",
    "executive", "officer", "specialist", "manager", "mgr", "staff", "team",
    "i", "ii", "iii", "iv", "1", "2", "3", "full", "time", "part", "contract",
}
# Seniority words compare separately: "Senior Marketing Executive" is a fair
# match for "Marketing Executive", just not a perfect one
SENIORITY_WORDS = {"senior", "junior", "assistant", "associate", "lead", "head", "manager", "executive", "director"}


def html_to_text(raw: str) -> str:
    """Job descriptions arrive as HTML; turn them into plain text."""
    text = re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", raw or "", flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n\s*\n+", "\n", text)).strip()


def normalize(text: str) -> str:
    """Lowercase, keep letters/digits (and + # for C++/C#), single spaces."""
    return " " + " ".join(re.findall(r"[a-z0-9+#]+", (text or "").lower())) + " "


def skill_variants(skill: str) -> list[str]:
    """'Search Engine Optimization (SEO)' -> ['search engine optimization', 'seo']."""
    variants = [skill]
    inner = re.findall(r"\(([^)]+)\)", skill)
    if inner:
        variants = [re.sub(r"\([^)]*\)", "", skill)] + inner
    out = []
    for v in variants:
        n = normalize(v).strip()
        if len(n) >= 2 and n not in out:
            out.append(n)
    return out


def _title_tokens(text: str) -> set[str]:
    return {t for t in normalize(text).split() if t not in TITLE_STOPWORDS and len(t) > 1}


def title_fit(target: str, job_title: str) -> float:
    target_tokens = _title_tokens(target)
    if not target_tokens:
        return 0.5  # no target role given: neutral
    job_norm = normalize(job_title)
    if normalize(target).strip() and normalize(target) in job_norm:
        return 1.0  # exact phrase, e.g. "marketing executive" in "Senior Marketing Executive"
    overlap = len(target_tokens & _title_tokens(job_title)) / len(target_tokens)
    # Small bonus when the seniority words line up too
    target_level = set(normalize(target).split()) & SENIORITY_WORDS
    job_level = set(job_norm.split()) & SENIORITY_WORDS
    bonus = 0.1 if target_level and target_level & job_level else 0.0
    return min(1.0, overlap * 0.9 + bonus)


def matched_skills(profile_skills: list[str], job_tags: list[str], description: str) -> tuple[list[str], list[str]]:
    """Which of your skills this job asks for, and which of its tags you lack."""
    tags_norm = [normalize(t) for t in job_tags]
    desc_norm = normalize(description)
    have = []
    for skill in profile_skills:
        for v in skill_variants(skill):
            padded = f" {v} "
            if any(padded in t or t.strip() == v for t in tags_norm) or (len(v) > 3 and padded in desc_norm):
                have.append(skill)
                break
    have_norm = " ".join(normalize(s) for s in have)
    lacking = [t for t in job_tags if normalize(t).strip() and normalize(t) not in have_norm]
    return have, lacking


def experience_fit(your_years: int, required: int) -> tuple[float, str]:
    if not required:
        return 0.8, "no minimum stated"
    if your_years >= required:
        if your_years - required > 6:
            return 0.7, f"needs {required}+ yrs, you have {your_years} (may be over-qualified)"
        return 1.0, f"needs {required}+ yrs, you have {your_years}"
    gap = required - your_years
    return max(0.0, 1 - gap / 4), f"needs {required}+ yrs, you have {your_years}"


def salary_fit(min_salary: int | None, job_min: int | None, job_max: int | None) -> tuple[float, str]:
    top = job_max or job_min
    if not min_salary:
        return 0.7, "no minimum set" if not top else f"up to S${top:,}"
    if not top:
        return 0.5, "salary not stated"
    if top >= min_salary:
        return 1.0, f"up to S${top:,} (meets your S${min_salary:,})"
    return max(0.0, top / min_salary - 0.3), f"up to S${top:,} (below your S${min_salary:,})"


def rank_jobs(profile, jobs: list, target_role: str = "", min_salary: int | None = None) -> list:
    """Score every job, attach the breakdown, and sort best first."""
    target = target_role or profile.title
    for job in jobs:
        description = html_to_text(job.description)
        t = title_fit(target, job.title)
        have, lacking = matched_skills(profile.skills, job.skills, description)
        # 6 matching skills counts as a full skills score; fewer scales down
        s = min(1.0, len(have) / max(3, min(len(profile.skills), 6))) if profile.skills else 0.5
        e, e_note = experience_fit(profile.experience_years, job.experience_required)
        p, p_note = salary_fit(min_salary, job.salary_min, job.salary_max)

        job.match_score = round(100 * (WEIGHTS["title"] * t + WEIGHTS["skills"] * s
                                       + WEIGHTS["experience"] * e + WEIGHTS["salary"] * p), 1)
        job.matched_skills = have
        job.missing_skills = lacking[:6]
        job.score_breakdown = {
            "title": round(t * 100),
            "skills": round(s * 100),
            "experience": round(e * 100),
            "salary": round(p * 100),
            "experience_note": e_note,
            "salary_note": p_note,
        }
        # Keep descriptions short in responses; the full text is on the job page
        job.description = description[:1500]
    jobs.sort(key=lambda j: j.match_score, reverse=True)
    return jobs
