"""
CareerFlow SG — Backend
Autonomous multi-agent career workflow engine for Singapore job seekers.
"""

import os
import re
import json
import hmac
import time
import hashlib
import httpx
import asyncio
from typing import Optional, Union
from pathlib import Path
from datetime import datetime
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

from dotenv import load_dotenv
from docx import Document
from playwright.async_api import async_playwright

load_dotenv()

# ─── Configuration (backend/.env, see .env.example) ──────────────
# Any OpenAI-compatible chat API works: Groq (default), Google Gemini, OpenRouter, Ollama...
LLM_API_KEY = os.getenv("MODEL_API_KEY", "").strip()
if LLM_API_KEY.startswith("paste-your-key") or LLM_API_KEY.endswith("-here"):
    LLM_API_KEY = ""  # still the .env.example placeholder
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").strip().rstrip("/")
MODEL_ID = os.getenv("MODEL_ID", "openai/gpt-oss-120b").strip()
MCF_API_BASE = os.getenv("MCF_API_BASE", "https://api.mycareersfuture.gov.sg/v2")
# Local providers (Ollama, LM Studio) need no key
LLM_IS_LOCAL = any(h in LLM_BASE_URL for h in ("localhost", "127.0.0.1", "[::1]"))

app = FastAPI(
    title="CareerFlow SG",
    description="Autonomous multi-agent career workflow engine for Singapore",
    version="1.0.0",
)

# Headless Chromium is the biggest memory user on the 512 MB free tier (each
# browser ~150-300 MB): allow one at a time and launch it lean, without images.
BROWSER_LOCK = asyncio.Semaphore(1)
BROWSER_ARGS = [
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--blink-settings=imagesEnabled=false",
]

MAX_RESUME_BYTES = 10 * 1024 * 1024
MAX_RESUME_PAGES = 10
MAX_RESUME_CHARS = 30_000

# Every API route except sign-in needs a valid invite token, so strangers can't
# spend the hosting budget or the Groq quota. Registered before CORS (runs inside it).
PUBLIC_API_PATHS = {"/api/auth/verify", "/api/auth/check"}

@app.middleware("http")
async def require_invite_token(request, call_next):
    path = request.url.path
    if request.method != "OPTIONS" and path.startswith("/api/") and path not in PUBLIC_API_PATHS:
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        if not token_is_valid(token):
            return JSONResponse(status_code=401, content={"detail": "Please sign in with your invite code again."})
    return await call_next(request)

# Registered before CORS so it runs inside it: unhandled errors come back as JSON
# with CORS headers, instead of a bare 500 the browser reports as "Failed to fetch".
@app.middleware("http")
async def catch_unhandled_errors(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        import traceback
        print(f"Unhandled error on {request.url.path}: {e!r}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": "Something went wrong on our side. Please try again."},
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Data Models ─────────────────────────────────────────────────

class ProfileData(BaseModel):
    name: str = ""
    # Contact details, carried into generated resumes and application forms
    email: str = ""
    phone: str = ""
    linkedin: str = ""
    portfolio: str = ""
    location: str = ""
    title: str = ""
    summary: str = ""
    skills: list[str] = []
    experience_years: int = 0
    education: list[str] = []
    work_history: list[dict] = []
    certifications: list[str] = []

class JobListing(BaseModel):
    uuid: str
    title: str
    company: str
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_type: str = "Monthly"
    skills: list[str] = []
    experience_required: int = 0
    location: str = ""
    district: str = ""
    region: str = ""
    employment_type: str = ""
    position_level: str = ""
    description: str = ""
    job_url: str = ""
    posted_date: str = ""
    views: int = 0
    applications: int = 0
    match_score: float = 0.0
    source: str = "mcf"  # mcf, jobstreet, indeed, linkedin, glassdoor
    # Why the job was ranked where it was (see matching.py)
    match_reason: str = ""
    matched_skills: list[str] = []
    missing_skills: list[str] = []
    score_breakdown: dict = {}
    ai_ranked: bool = False

class InterviewPrep(BaseModel):
    behavioral_questions: list[dict] = []  # {question, why_asked, star_framework_hint}
    technical_questions: list[dict] = []  # {question, topic, difficulty}
    company_research: dict = {}
    negotiation_tips: list[str] = []

# ─── LLM Client (Groq) ───────────────────────────────────────────

def _retry_delay(response: httpx.Response) -> float:
    """Seconds to wait before retrying a 429, from Groq's headers or message (max 30s)."""
    import re
    try:
        delay = float(response.headers.get("retry-after", ""))
    except ValueError:
        match = re.search(r"try again in ([\d.]+)s", response.text)
        delay = float(match.group(1)) if match else 10.0
    return min(delay + 0.5, 30.0)

async def call_llm(
    system_prompt: str,
    user_prompt: str,
    tools: Optional[list] = None,
    response_format: Optional[dict] = None,
    max_tokens: int = 8192,
    temperature: float = 0.7,
) -> str:
    """Call the LLM (Groq, OpenAI-compatible chat completions)."""
    if not LLM_API_KEY and not LLM_IS_LOCAL:
        raise HTTPException(
            status_code=500,
            detail="No AI key set up. Open backend/.env, paste your key after MODEL_API_KEY=, then restart the backend.",
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    async with httpx.AsyncClient(timeout=120.0) as client:
        payload = {
            "model": MODEL_ID,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        # GPT-OSS is a reasoning model: its thinking counts against max_tokens and can
        # leave an empty answer on big prompts (e.g. scoring 30 jobs). Keep it brief.
        if "gpt-oss" in MODEL_ID:
            payload["reasoning_effort"] = "low"
        if tools:
            payload["tools"] = tools
        if response_format:
            payload["response_format"] = response_format

        # Retry rate limits (free tier: 8k tokens/minute) and the occasional
        # malformed-JSON generation, waiting as long as Groq asks (capped).
        for attempt in range(3):
            response = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {LLM_API_KEY or 'local'}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response.status_code == 429 and attempt < 2:
                await asyncio.sleep(_retry_delay(response))
                continue
            if response.status_code == 400 and "json_validate_failed" in response.text and attempt < 1:
                continue
            # Some providers don't support JSON mode or reasoning_effort; the prompt asks for JSON anyway
            if response.status_code == 400 and attempt < 2 and ("response_format" in response.text or "reasoning" in response.text):
                payload.pop("response_format", None)
                payload.pop("reasoning_effort", None)
                continue
            break

        if response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="The AI service is busy right now. Please wait a minute and try again.",
            )
        if response.status_code in (401, 403):
            raise HTTPException(status_code=500, detail="Your AI provider rejected the key. Check MODEL_API_KEY in backend/.env, then restart the backend.")
        if response.status_code == 404 or "model_not_found" in response.text or "does not exist" in response.text:
            raise HTTPException(status_code=500, detail=f"The model \"{MODEL_ID}\" wasn't found at {LLM_BASE_URL}. Check MODEL_ID in backend/.env.")
        if response.status_code != 200:
            print(f"LLM API error {response.status_code}: {response.text[:500]}")
            # 500, not 502: the frontend retries 502-504 as "server waking up"
            raise HTTPException(
                status_code=500,
                detail=f"LLM API error: {response.text}",
            )

        data = response.json()
        return data["choices"][0]["message"]["content"]

async def call_llm_structured(
    system_prompt: str,
    user_prompt: str,
    schema: dict,
    temperature: float = 0.4,
) -> dict:
    """Call the LLM and parse a structured JSON response."""
    # Not every Groq model supports `json_schema` output, so use JSON mode and
    # describe the schema in the prompt (JSON mode also requires the word "JSON").
    system_prompt = (
        f"{system_prompt}\n\nRespond with a single JSON object only, no prose, "
        f"matching this JSON Schema:\n{json.dumps(schema)}"
    )
    text = await call_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    # Parse JSON from response (handle markdown code blocks)
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text)

# ─── MyCareersFuture API Client ──────────────────────────────────

async def search_mcf_jobs(
    query: str,
    limit: int = 50,
    salary_min: Optional[int] = None,
    employment_type: Optional[str] = None,
) -> list[JobListing]:
    """Search MyCareersFuture's public API, fetching pages of 100 in parallel."""
    per_page = min(limit, 100)
    pages = max(1, -(-limit // per_page))  # ceiling division
    base_params = {"search": query, "limit": per_page}
    if salary_min:
        base_params["salary"] = salary_min  # jobs whose range reaches this amount
    if employment_type:
        base_params["employmentTypes"] = employment_type

    async with httpx.AsyncClient(timeout=45.0) as client:
        responses = await asyncio.gather(*[
            client.get(f"{MCF_API_BASE}/jobs", params={**base_params, "page": page})
            for page in range(pages)
        ])
    results = []
    for response in responses:
        response.raise_for_status()
        results.extend(response.json().get("results", []))

    jobs = []
    seen = set()
    for job in results[:limit]:
        if job.get("uuid") in seen:
            continue
        seen.add(job.get("uuid"))
        company = job.get("postedCompany", {})
        address = job.get("address", {})
        salary = job.get("salary", {})
        metadata = job.get("metadata", {})
        districts = address.get("districts", [])

        jobs.append(JobListing(
            uuid=job.get("uuid", ""),
            title=job.get("title", ""),
            company=company.get("name", ""),
            salary_min=salary.get("minimum"),
            salary_max=salary.get("maximum"),
            salary_type=salary.get("type", {}).get("salaryType", "Monthly"),
            skills=[s.get("skill", "") for s in job.get("skills", [])],
            experience_required=job.get("minimumYearsExperience", 0) or 0,
            location=address.get("street", "") or "",
            district=districts[0].get("location", "") if districts else "",
            region=districts[0].get("region", "") if districts else "",
            employment_type=", ".join(
                e.get("employmentType", "") for e in job.get("employmentTypes", [])
            ),
            position_level=", ".join(
                p.get("position", "") for p in job.get("positionLevels", [])
            ),
            description=job.get("description", ""),
            job_url=metadata.get("jobDetailsUrl", ""),
            posted_date=metadata.get("newPostingDate", ""),
            views=metadata.get("totalNumberOfView", 0),
            applications=metadata.get("totalNumberJobApplication", 0),
            match_score=0.0,
        ))

    return jobs

# ─── Agent Functions ─────────────────────────────────────────────

async def agent_parse_profile(resume_text: str) -> ProfileData:
    """Parse resume text into structured profile data."""
    system_prompt = """You are an expert career analyst specializing in the Singapore job market.
Extract structured profile data from the resume. Be precise about skills, experience levels,
and education. Identify both hard skills (technologies, tools) and soft skills.
Copy contact details (email, phone, LinkedIn URL, portfolio/website URL, location) exactly
as written in the resume; use an empty string for any that are not present. Never invent them.
Return valid JSON matching the schema."""

    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "email": {"type": "string"},
            "phone": {"type": "string"},
            "linkedin": {"type": "string"},
            "portfolio": {"type": "string"},
            "location": {"type": "string"},
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "skills": {"type": "array", "items": {"type": "string"}},
            "experience_years": {"type": "integer"},
            "education": {"type": "array", "items": {"type": "string"}},
            "work_history": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "company": {"type": "string"},
                        "role": {"type": "string"},
                        "duration": {"type": "string"},
                        "achievements": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "certifications": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name", "title", "summary", "skills", "experience_years"],
    }

    result = await call_llm_structured(system_prompt, resume_text, schema, temperature=0)
    # Drop nulls so model defaults apply instead of failing validation
    return ProfileData(**{k: v for k, v in result.items() if v is not None})

async def agent_match_jobs(
    profile: ProfileData,
    jobs: list[JobListing],
    target_role: str = "",
    target_industry: str = "",
    min_salary: Optional[int] = None,
    ai_top_n: int = 15,
) -> list[JobListing]:
    """
    Rank jobs in two steps:
      1. matching.rank_jobs scores every job in code (title, skills, experience, salary).
      2. The AI re-reads only the top `ai_top_n`, re-scores them and explains each one.
    Final score for re-ranked jobs = average of the code score and the AI score.
    """
    from matching import rank_jobs

    jobs = rank_jobs(profile, jobs, target_role=target_role, min_salary=min_salary)
    top = jobs[:ai_top_n]
    if not top:
        return jobs

    system_prompt = f"""You are a careful recruiter for the Singapore job market.
Target role: {target_role or profile.title}
Target industry: {target_industry or "any"}

For each job, judge how well this candidate fits, 0-100, considering: skills they have that
the job needs, experience level, whether the role is a sensible next step, and industry fit.
Be honest: a poor fit should score low. For each job give a one-sentence reason (max 25 words)
written to the candidate ("You..."), and up to 3 important requirements they appear to lack."""

    profile_summary = json.dumps({
        "title": profile.title,
        "experience_years": profile.experience_years,
        "skills": profile.skills[:25],
        "summary": profile.summary[:600],
    }, separators=(",", ":"))

    # Compact JSON and short numeric ids keep this under free-tier token limits
    jobs_summary = json.dumps([
        {
            "id": i,
            "title": j.title,
            "company": j.company,
            "min_years": j.experience_required,
            "level": j.position_level,
            "salary": f"{j.salary_min or '?'}-{j.salary_max or '?'}",
            "skills": j.skills[:12],
            "about": j.description[:450],
        }
        for i, j in enumerate(top)
    ], separators=(",", ":"))

    user_prompt = (
        f"Candidate:\n{profile_summary}\n\nJobs:\n{jobs_summary}\n\n"
        'Return JSON: {"jobs": [{"id": 0, "match_score": 0-100, "reason": "...", "lacking": ["..."]}]}'
    )

    schema = {
        "type": "object",
        "properties": {
            "jobs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "match_score": {"type": "number"},
                        "reason": {"type": "string"},
                        "lacking": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["id", "match_score", "reason"],
                },
            },
        },
        "required": ["jobs"],
    }

    try:
        result = await call_llm_structured(system_prompt, user_prompt, schema, temperature=0)
    except HTTPException as e:
        # The code ranking still stands on its own if the AI is busy or down
        print(f"AI re-rank skipped: {e.detail}")
        return jobs

    for item in result.get("jobs", []):
        try:
            job = top[int(item["id"])]
            ai_score = max(0.0, min(100.0, float(item["match_score"])))
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        job.score_breakdown["code"] = job.match_score
        job.score_breakdown["ai"] = round(ai_score)
        job.match_score = round((job.match_score + ai_score) / 2, 1)
        job.match_reason = str(item.get("reason", ""))[:300]
        lacking = [str(x) for x in item.get("lacking", []) if x][:3]
        if lacking:
            job.missing_skills = lacking
        job.ai_ranked = True

    jobs.sort(key=lambda j: (j.ai_ranked, j.match_score), reverse=True)
    return jobs

async def agent_interview_prep(
    profile: ProfileData,
    target_job: JobListing,
) -> InterviewPrep:
    """Generate interview preparation materials for a specific job."""
    system_prompt = """You are an interview coaching expert for Singapore's job market.
Generate targeted interview preparation materials based on the candidate's profile
and the specific job they're interviewing for. Include behavioral questions (STAR method),
technical questions, company research points, and salary negotiation tips specific to SG."""

    profile_text = f"""Title: {profile.title}
Skills: {', '.join(profile.skills)}
Experience: {profile.experience_years} years"""

    job_text = f"""Job: {target_job.title} at {target_job.company}
Skills Required: {', '.join(target_job.skills)}
Level: {target_job.position_level}
Salary Range: ${target_job.salary_min or 'N/A'} - ${target_job.salary_max or 'N/A'}/month"""

    user_prompt = f"""Candidate: {profile_text}\nTarget Job: {job_text}\n\nGenerate comprehensive interview preparation materials."""

    schema = {
        "type": "object",
        "properties": {
            "behavioral_questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "why_asked": {"type": "string"},
                        "star_framework_hint": {"type": "string"},
                    },
                },
            },
            "technical_questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "topic": {"type": "string"},
                        "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    },
                },
            },
            "company_research": {
                "type": "object",
                "properties": {
                    "key_facts": {"type": "array", "items": {"type": "string"}},
                    "recent_news": {"type": "array", "items": {"type": "string"}},
                    "culture_notes": {"type": "array", "items": {"type": "string"}},
                },
            },
            "negotiation_tips": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["behavioral_questions", "technical_questions"],
    }

    result = await call_llm_structured(system_prompt, user_prompt, schema)
    return InterviewPrep(**result)

# ─── API Endpoints ───────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "CareerFlow SG",
        "llm_configured": bool(LLM_API_KEY) or LLM_IS_LOCAL,
        "model": MODEL_ID,
        "provider": LLM_BASE_URL.split("//")[-1].split("/")[0],
        "skills_framework": (Path(__file__).parent / "data" / "skills_framework.json.gz").exists(),
    }

@app.post("/api/profile/parse", response_model=ProfileData)
async def parse_profile(resume: UploadFile = File(...)):
    """Upload a resume (PDF or TXT) and get structured profile data."""
    content = await resume.read()
    if len(content) > MAX_RESUME_BYTES:
        raise HTTPException(status_code=413, detail="Resume file is too large (max 10 MB)")

    filename = (resume.filename or "").lower()
    if filename.endswith(".pdf") or content[:5] == b"%PDF-":
        try:
            import io
            import pdfplumber
            parts = []
            # Free each page after extracting it: the free hosting tier has 512 MB of RAM
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages[:MAX_RESUME_PAGES]:
                    parts.append(page.extract_text() or "")
                    page.close()
            text = "\n".join(parts)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't read this PDF: {str(e)}")
    else:
        text = content.decode("utf-8", errors="ignore")

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="No text found in this resume. If it's a scanned image, paste the text instead.",
        )

    return await agent_parse_profile(text[:MAX_RESUME_CHARS])

@app.post("/api/profile/parse-text", response_model=ProfileData)
async def parse_profile_text(resume_text: str = Form(...)):
    """Parse resume from plain text input."""
    if not resume_text.strip():
        raise HTTPException(status_code=400, detail="Resume text is empty")
    return await agent_parse_profile(resume_text)

@app.get("/api/jobs/search")
async def search_jobs(
    query: str = "software engineer",
    limit: int = 20,
    salary_min: Optional[int] = None,
    sources: str = "mcf",  # comma-separated: mcf,jobstreet,indeed,linkedin,glassdoor
):
    """Search jobs from MyCareersFuture and/or web scrapers."""
    source_list = [s.strip() for s in sources.split(",")] if sources else ["mcf"]
    
    if "mcf" in source_list and len(source_list) == 1:
        # Fast path: only MCF API
        jobs = await search_mcf_jobs(query, limit=limit, salary_min=salary_min)
    else:
        # Multi-portal: scrape in parallel
        from scrapers import scrape_all_portals
        jobs = await scrape_all_portals(query, limit=limit, sources=source_list)
    
    return {"total": len(jobs), "jobs": [j.model_dump() for j in jobs]}

async def resolve_profile(profile_json: Optional[str], resume_text: Optional[str]) -> ProfileData:
    """The candidate: the structured profile the browser holds, else parsed from resume text."""
    if profile_json:
        try:
            return ProfileData.model_validate_json(profile_json)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid profile data; please re-upload your resume.")
    if resume_text and resume_text.strip():
        return await agent_parse_profile(resume_text)
    raise HTTPException(status_code=400, detail="No profile: please upload your resume first.")

def _optional_int(value: Optional[str]) -> Optional[int]:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None

async def find_jobs(query: str, limit: int, sources: str, min_salary: Optional[int], employment_type: str) -> list[JobListing]:
    source_list = [s.strip() for s in sources.split(",") if s.strip()] if sources else ["mcf"]
    filters = {"salary_min": min_salary, "employment_type": employment_type or None}
    if source_list == ["mcf"]:
        return await search_mcf_jobs(query, limit=limit, **filters)
    from scrapers import scrape_all_portals
    return await scrape_all_portals(query, limit=limit, sources=source_list, mcf_filters=filters)

@app.post("/api/jobs/match", response_model=list[JobListing])
async def match_jobs(
    query: str = Form(""),
    limit: int = Form(200),
    resume_text: str = Form(None),
    profile_json: str = Form(None),
    target_role: str = Form(""),
    target_industry: str = Form(""),
    sources: str = Form("mcf"),  # comma-separated portal sources
    min_salary: str = Form(""),
    employment_type: str = Form(""),
):
    """Search jobs, rank them all in code, then have the AI re-rank and explain the best."""
    profile = await resolve_profile(profile_json, resume_text)
    query = (query or target_role or profile.title).strip()
    if not query:
        raise HTTPException(status_code=400, detail="Enter a target role to search for.")
    salary = _optional_int(min_salary)
    jobs = await find_jobs(query, min(max(limit, 10), 200), sources, salary, employment_type)
    return await agent_match_jobs(profile, jobs, target_role=target_role or query,
                                  target_industry=target_industry, min_salary=salary)

async def resolve_job(job_uuid: Optional[str], job_json: Optional[str]) -> Optional[JobListing]:
    """The job to work on: as sent by the frontend (any portal), else fetched from MCF by uuid."""
    if job_json:
        try:
            return JobListing.model_validate_json(job_json)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid job data")
    if not job_uuid:
        return None
    if not re.fullmatch(r"[0-9a-f]{32}", job_uuid):
        raise HTTPException(status_code=400, detail="This job isn't from MyCareersFuture; please search again.")
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{MCF_API_BASE}/jobs/{job_uuid}")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="This job listing is no longer available.")
    response.raise_for_status()
    job_data = response.json()
    salary = job_data.get("salary") or {}
    return JobListing(
        uuid=job_data.get("uuid", ""),
        title=job_data.get("title", ""),
        company=(job_data.get("postedCompany") or {}).get("name", ""),
        salary_min=salary.get("minimum"),
        salary_max=salary.get("maximum"),
        salary_type=(salary.get("type") or {}).get("salaryType", "Monthly"),
        skills=[sk.get("skill", "") for sk in job_data.get("skills", [])],
        experience_required=job_data.get("minimumYearsExperience", 0) or 0,
        position_level=", ".join(pl.get("position", "") for pl in job_data.get("positionLevels", [])),
        description=job_data.get("description", ""),
        job_url=(job_data.get("metadata") or {}).get("jobDetailsUrl", ""),
    )

@app.post("/api/interview/prep")
async def interview_prep(
    resume_text: str = Form(None),
    profile_json: str = Form(None),
    job_uuid: str = Form(None),
    job_json: str = Form(None),
):
    """Generate interview preparation materials for a specific job."""
    profile = await resolve_profile(profile_json, resume_text)
    job = await resolve_job(job_uuid, job_json)
    if not job:
        raise HTTPException(status_code=400, detail="No job selected")

    prep = await agent_interview_prep(profile, job)
    return prep.model_dump()

# ─── Skill gaps (SkillsFuture Skills Framework) ──────────────────

async def agent_skill_gap(profile: ProfileData, role_id: int, jobs: list[JobListing]) -> dict:
    """Compare the profile with an official Skills Framework role and explain every gap."""
    import skills_gap as sg
    from matching import normalize

    role = sg.role_details(role_id)
    needed = sg.role_skills(role_id)
    # Rank the role's skills by how much the user's matched listings and profile talk about them
    corpus = normalize(" ".join(t for j in jobs for t in (j.skills + [j.title])) + " " + " ".join(profile.skills))
    def relevance(skill):
        words = [w for w in normalize(skill["title"]).split() if len(w) > 3 and w not in {"management", "and", "development"}]
        return sum(corpus.count(f" {w} ") for w in words) + (1 if skill["type"].startswith("Critical") else 0)
    ranked = sorted(needed, key=relevance, reverse=True)
    assessed, others = ranked[:20], ranked[20:]

    system_prompt = """You are a career coach in Singapore who explains SkillsFuture Skills Framework
requirements in plain, encouraging English to job seekers (no jargon, no acronyms like TSC).
For each skill, compare it with the candidate's profile and decide:
- "strong": the profile clearly shows this skill at roughly the required level
- "partial": some related experience, but not clearly at the required level
- "gap": nothing in the profile shows it yet
Be honest and specific. Quote or paraphrase the candidate's own experience as evidence; never invent any.
Write every explanation to the candidate directly ("you", "your"), never "the candidate"."""
    candidate = {
        "title": profile.title, "years": profile.experience_years, "skills": profile.skills,
        "summary": profile.summary[:500],
        "experience": [{"role": w.get("role"), "achievements": (w.get("achievements") or [])[:4]}
                       for w in profile.work_history[:4] if isinstance(w, dict)],
        "certifications": profile.certifications,
    }
    skills_in = [{"i": i, "skill": s["title"], "level": s["level"], "means": s["description"][:160],
                  "at_this_level": s["level_description"][:160]} for i, s in enumerate(assessed)]
    user_prompt = (
        f"Target role: {role['role']} ({role['sector']} sector)\n\nCandidate:\n{json.dumps(candidate, separators=(',', ':'))}\n\n"
        f"Skills this role needs (official Skills Framework):\n{json.dumps(skills_in, separators=(',', ':'))}\n\n"
        'Return JSON: {"overview": "2 sentences on overall readiness, speaking to the candidate as you", "skills": [{"i": 0, "status": "strong|partial|gap", '
        '"evidence": "from their profile, or empty", "why_it_matters": "max 30 words, for this role", '
        '"how_to_build": "1-2 concrete next steps, max 35 words"}]}'
    )
    schema = {"type": "object", "properties": {
        "overview": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "object", "properties": {
            "i": {"type": "integer"}, "status": {"type": "string", "enum": ["strong", "partial", "gap"]},
            "evidence": {"type": "string"}, "why_it_matters": {"type": "string"}, "how_to_build": {"type": "string"}},
            "required": ["i", "status"]}}},
        "required": ["overview", "skills"]}
    result = await call_llm_structured(system_prompt, user_prompt, schema, temperature=0)

    for item in result.get("skills", []):
        try:
            skill = assessed[int(item["i"])]
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        status = item.get("status")
        skill["status"] = status if status in {"strong", "partial", "gap"} else "gap"
        skill["evidence"] = str(item.get("evidence") or "")[:300]
        skill["why_it_matters"] = str(item.get("why_it_matters") or "")[:300]
        skill["how_to_build"] = str(item.get("how_to_build") or "")[:300]
    for skill in assessed:
        skill.setdefault("status", "gap")
    order = {"gap": 0, "partial": 1, "strong": 2}
    assessed.sort(key=lambda s: (order[s["status"]], -int(s["level"] or 0)))

    counts = {k: sum(1 for s in assessed if s["status"] == k) for k in order}
    return {
        "role": {"id": role["id"], "role": role["role"], "sector": role["sector"], "track": role["track"],
                 "description": role["description"], "functions": role["functions"]},
        "overview": str(result.get("overview", "")),
        "counts": counts,
        "skills": assessed,
        "other_skills": [{"title": s["title"], "level": s["level"], "type": s["type"],
                          "description": s["description"], "course_search_url": s["course_search_url"]} for s in others],
        "market": sg.market_signals(profile, jobs),
        "source": "SkillsFuture Skills Framework (jobsandskills.swda.gov.sg)",
    }

def _jobs_from_form(jobs_json: Optional[str]) -> list[JobListing]:
    try:
        return [JobListing.model_validate(j) for j in json.loads(jobs_json or "[]")][:40]
    except (ValueError, TypeError):
        return []

@app.post("/api/skills/roles")
async def skills_roles(profile_json: str = Form(None), target_role: str = Form(""), target_industry: str = Form("")):
    """Official Skills Framework job roles that match the target role."""
    import skills_gap as sg
    profile = await resolve_profile(profile_json, None)
    try:
        roles = sg.find_roles(target_role or profile.title, target_industry)
    except sg.FrameworkMissing as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"roles": roles}

@app.post("/api/skills/gap")
async def skills_gap_analysis(profile_json: str = Form(None), role_id: int = Form(...), jobs_json: str = Form(None)):
    """Compare the profile with one Skills Framework role, explain gaps, and add market signals."""
    import skills_gap as sg
    profile = await resolve_profile(profile_json, None)
    try:
        return await agent_skill_gap(profile, role_id, _jobs_from_form(jobs_json))
    except sg.FrameworkMissing as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

# ─── Tailored resumes (templates, ATS rules) ─────────────────────

# Writing rules distilled from sg-job-hunter's ats-rules.yml and cv.example.md
ATS_WRITING_RULES = """ATS writing rules (follow all):
- Never invent employers, job titles, dates, qualifications, tools or numbers. Only rephrase,
  reorder and emphasise what the candidate actually has. If a result has no real figure,
  describe its scope instead of making one up.
- Bullets: start with a strong past-tense action verb, then what was done, then the result
  ("Grew X by Y% by doing Z"). One line, at most about 25 words. No "Responsible for".
- Mirror the job's exact wording for skills the candidate genuinely has (e.g. write
  "Search Engine Optimisation (SEO)" if the job says so), so keyword filters match.
- No first-person pronouns (I, me, my). No hidden text or keyword stuffing.
- Summary: 2-3 sentences, about 40-70 words. Open with the target title and years of
  experience, then the strongest relevant achievement, then what they bring to this role.
- Core competencies: 6-10 short keyword phrases taken from the job that the candidate has.
- Keep every experience entry, in the same order. Rewrite each of the candidate's existing
  bullets; you may reorder them so the most relevant comes first, but never add a bullet
  that has no original, and return at most as many bullets as the entry had.
- Competencies and skills may only include things the candidate already lists or clearly
  shows in their bullets. Job keywords they lack belong in "suggested_keywords" instead."""

def profile_to_resume(profile: ProfileData) -> "ResumeDoc":
    """Everything factual comes straight from the profile; the AI only rewrites wording."""
    from resume_render import ResumeDoc, ExperienceEntry, EducationEntry, CertificationEntry, SkillGroup

    def split_edu(text: str) -> EducationEntry:
        year = re.search(r"(19|20)\d{2}(\s*[-–]\s*((19|20)\d{2}|present))?", text, re.I)
        rest = text.replace(year.group(0), "").strip(" ,()-–") if year else text
        title, _, org = rest.partition(",")
        return EducationEntry(title=title.strip(), org=org.strip(), year=year.group(0) if year else "")

    return ResumeDoc(
        name=profile.name, title=profile.title, email=profile.email, phone=profile.phone,
        linkedin=profile.linkedin, portfolio=profile.portfolio, location=profile.location,
        summary=profile.summary,
        experience=[
            ExperienceEntry(company=w.get("company", ""), role=w.get("role", ""),
                            period=w.get("duration", ""), bullets=list(w.get("achievements") or []))
            for w in profile.work_history if isinstance(w, dict)
        ],
        education=[split_edu(e) for e in profile.education if e],
        certifications=[CertificationEntry(title=c) for c in profile.certifications if c],
        skills=[SkillGroup(category="Skills", items=profile.skills)] if profile.skills else [],
    )

async def agent_tailor_resume(profile: ProfileData, job: JobListing) -> dict:
    """Return a tailored ResumeDoc for one job, plus the job's keywords and what changed."""
    base = profile_to_resume(profile)
    system_prompt = f"""You are an expert resume writer for the Singapore job market.
Tailor the candidate's resume to one job so it passes ATS keyword screening and reads
well to a recruiter.

{ATS_WRITING_RULES}"""

    candidate = {
        "target_title": job.title,
        "current_title": profile.title,
        "experience_years": profile.experience_years,
        "summary": profile.summary,
        "skills": profile.skills,
        "experience": [{"index": i, "role": e.role, "company": e.company, "bullets": e.bullets}
                       for i, e in enumerate(base.experience)],
        "certifications": profile.certifications,
    }
    job_info = {
        "title": job.title, "company": job.company, "level": job.position_level,
        "min_years": job.experience_required, "skill_tags": job.skills[:20],
        "description": (job.description or "")[:2500],
    }
    user_prompt = (
        f"Candidate:\n{json.dumps(candidate, separators=(',', ':'))}\n\nJob:\n{json.dumps(job_info, separators=(',', ':'))}\n\n"
        "Return JSON with: job_keywords (8-12 most important skills/terms this job screens for, in the job's "
        "own wording), summary, competencies, experience (one item per candidate experience index, with "
        "rewritten bullets, no more than it had), skills (grouped, e.g. Tools / Marketing / Languages, only skills "
        "the candidate has), suggested_keywords (important job keywords the candidate does not show), and changes "
        "(3-5 short notes telling the candidate what you changed and why)."
    )
    schema = {
        "type": "object",
        "properties": {
            "job_keywords": {"type": "array", "items": {"type": "string"}},
            "summary": {"type": "string"},
            "competencies": {"type": "array", "items": {"type": "string"}},
            "experience": {"type": "array", "items": {"type": "object", "properties": {
                "index": {"type": "integer"}, "bullets": {"type": "array", "items": {"type": "string"}}}}},
            "skills": {"type": "array", "items": {"type": "object", "properties": {
                "category": {"type": "string"}, "items": {"type": "array", "items": {"type": "string"}}}}},
            "suggested_keywords": {"type": "array", "items": {"type": "string"}},
            "changes": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["job_keywords", "summary", "competencies", "experience", "skills"],
    }
    result = await call_llm_structured(system_prompt, user_prompt, schema, temperature=0.3)

    # ── Guardrails: the AI may rephrase, never add. Enforced here, not just in the prompt.
    from matching import normalize, skill_variants
    from resume_render import SkillGroup
    evidence = normalize(" ".join([profile.title, profile.summary, " ".join(profile.skills), " ".join(profile.certifications),
                                   " ".join(b for e in base.experience for b in e.bullets)]))

    def backed(term: str) -> bool:
        return any(f" {v} " in evidence for v in skill_variants(term))

    suggestions: list[str] = [str(k).strip() for k in result.get("suggested_keywords", []) if str(k).strip()]
    doc = base.model_copy(deep=True)
    doc.title = job.title if profile.title.lower() not in job.title.lower() else profile.title
    doc.summary = str(result.get("summary") or base.summary).strip()
    doc.competencies = []
    for c in (str(c).strip() for c in result.get("competencies", [])):
        (doc.competencies if c and backed(c) else suggestions).append(c)
    doc.competencies = doc.competencies[:10]
    for item in result.get("experience", []):
        try:
            entry = doc.experience[int(item["index"])]
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        bullets = [str(b).strip() for b in item.get("bullets", []) if str(b).strip()]
        if bullets and entry.bullets:
            entry.bullets = bullets[:len(entry.bullets)]  # never more bullets than the original
    groups = []
    for g in result.get("skills", []):
        if not isinstance(g, dict):
            continue
        items = []
        for i in (str(i).strip() for i in g.get("items", [])):
            (items if i and backed(i) else suggestions).append(i)
        if items:
            groups.append(SkillGroup(category=str(g.get("category", "")), items=items))
    if groups:
        doc.skills = groups
    keywords = [str(k).strip() for k in result.get("job_keywords", []) if str(k).strip()][:12]
    suggestions = [s for s in dict.fromkeys(s for s in suggestions if s) if not backed(s)][:8]
    return {"resume": doc, "job_keywords": keywords, "suggested_keywords": suggestions,
            "changes": [str(c) for c in result.get("changes", [])][:5]}

def _resume_from_form(resume_json: str) -> "ResumeDoc":
    from resume_render import ResumeDoc
    try:
        return ResumeDoc.model_validate_json(resume_json)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid resume data")

@app.get("/api/resume/templates")
async def resume_templates():
    from resume_render import list_templates
    return list_templates()

@app.post("/api/resume/tailor")
async def tailor_resume(
    profile_json: str = Form(None),
    resume_text: str = Form(None),
    job_uuid: str = Form(None),
    job_json: str = Form(None),
    template: str = Form("ats"),
):
    """Tailor the resume to one job and score it against the ATS rules."""
    from resume_render import ats_check
    profile = await resolve_profile(profile_json, resume_text)
    job = await resolve_job(job_uuid, job_json)
    if not job:
        raise HTTPException(status_code=400, detail="No job selected")
    tailored = await agent_tailor_resume(profile, job)
    keywords = tailored["job_keywords"] or job.skills[:10]
    return {
        "resume": tailored["resume"].model_dump(),
        "job_keywords": keywords,
        "suggested_keywords": tailored["suggested_keywords"],
        "changes": tailored["changes"],
        "ats": ats_check(tailored["resume"], keywords, template),
    }

@app.post("/api/resume/ats")
async def resume_ats(resume_json: str = Form(...), job_keywords: str = Form("[]"), template: str = Form("ats")):
    """Re-score an edited resume (instant, no AI)."""
    from resume_render import ats_check
    try:
        keywords = [str(k) for k in json.loads(job_keywords or "[]")]
    except ValueError:
        keywords = []
    return ats_check(_resume_from_form(resume_json), keywords, template)

@app.post("/api/resume/render")
async def resume_render_html(resume_json: str = Form(...), template: str = Form("ats")):
    """HTML preview of a resume in a template (what the PDF will look like)."""
    from fastapi.responses import HTMLResponse
    from resume_render import render_html
    return HTMLResponse(render_html(_resume_from_form(resume_json), template))

@app.post("/api/resume/export")
async def resume_export(resume_json: str = Form(...), template: str = Form("ats"), format: str = Form("pdf")):
    """Download the resume as PDF (in the chosen template) or Word."""
    from fastapi.responses import Response
    from resume_render import render_html, render_pdf, render_docx
    doc = _resume_from_form(resume_json)
    base = re.sub(r"[^A-Za-z0-9]+", "_", doc.name or "CareerFlow").strip("_") or "CareerFlow"
    if format == "docx":
        return Response(render_docx(doc),
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="{base}_Resume.docx"'})
    pdf = await render_pdf(render_html(doc, template))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{base}_Resume.pdf"'})

# ─── Assisted apply (you review and submit) ──────────────────────

# One visible application window at a time; it closes itself after APPLY_WINDOW_MINUTES
APPLY_SESSION: dict = {}
APPLY_WINDOW_MINUTES = 20

async def close_apply_window():
    session = APPLY_SESSION.copy()
    APPLY_SESSION.clear()
    for key in ("browser", "playwright"):
        try:
            if session.get(key):
                await (session[key].close() if key == "browser" else session[key].stop())
        except Exception:
            pass
    if session.get("timer"):
        session["timer"].cancel()

async def agent_open_application(job_url: str, resume_pdf: str, profile: ProfileData) -> dict:
    """
    Open the job in a VISIBLE browser window on this computer, go to the application form
    if there is an "Apply" link, fill in the candidate's real details and attach their
    tailored resume. It never clicks Submit: the candidate checks everything and submits.
    """
    result = {"status": "started", "url": job_url, "steps": [], "errors": [], "filled": []}
    await close_apply_window()
    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=False)
        page = await (await browser.new_context(viewport=None)).new_page()
        APPLY_SESSION.update(playwright=pw, browser=browser)
        APPLY_SESSION["timer"] = asyncio.get_running_loop().call_later(
            APPLY_WINDOW_MINUTES * 60, lambda: asyncio.ensure_future(close_apply_window()))

        await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
        result["steps"].append("Opened the job page in a new browser window")

        # Follow an "Apply" link or button to the form. These open a form; they don't submit one.
        for selector in ['a:text-is("Apply")', 'a:text-is("Apply Now")', 'a:has-text("Apply for this job")',
                         'button:text-is("Apply")', 'button:text-is("Apply Now")', 'button:has-text("Apply for this job")']:
            try:
                el = await page.wait_for_selector(selector, timeout=1500, state="visible")
                if el:
                    await el.click()
                    await page.wait_for_load_state("domcontentloaded", timeout=10000)
                    result["steps"].append("Clicked the Apply link to reach the form")
                    break
            except Exception:
                continue

        first, _, last = profile.name.partition(" ")
        fields = [
            ("first name", first, ['input[name*="first" i]', 'input[placeholder*="first name" i]', 'input[autocomplete="given-name"]']),
            ("last name", last, ['input[name*="last" i]', 'input[placeholder*="last name" i]', 'input[autocomplete="family-name"]']),
            ("full name", profile.name, ['input[name="name"]', 'input[name*="fullname" i]', 'input[name*="full_name" i]',
                                         'input[placeholder*="full name" i]', 'input[autocomplete="name"]']),
            ("email", profile.email, ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="email" i]']),
            ("phone", profile.phone, ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="mobile" i]', 'input[placeholder*="phone" i]']),
            ("LinkedIn", profile.linkedin, ['input[name*="linkedin" i]', 'input[placeholder*="linkedin" i]']),
        ]
        for label, value, selectors in fields:
            if not value:
                continue
            for selector in selectors:
                try:
                    el = await page.query_selector(selector)
                    if el and await el.is_visible() and not await el.input_value():
                        await el.fill(value)
                        result["filled"].append(label)
                        break
                except Exception:
                    continue

        uploaded = False
        for el in await page.query_selector_all('input[type="file"]'):
            try:
                await el.set_input_files(resume_pdf)
                uploaded = True
                break
            except Exception:
                continue
        if result["filled"]:
            result["steps"].append(f"Filled in your {', '.join(result['filled'])}")
        if uploaded:
            result["steps"].append("Attached your tailored resume (PDF)")
        if not result["filled"] and not uploaded:
            result["errors"].append(
                "No application form was found on this page yet. Many sites (including MyCareersFuture) ask you to "
                "sign in first: sign in in the browser window, then fill in the form.")
        result["steps"].append("Stopped before submitting. Check everything in the browser window, then press Submit yourself.")
        result["status"] = "ready_for_review"
        result["resume_pdf"] = resume_pdf
    except Exception as e:
        result["status"] = "failed"
        result["errors"].append(f"Couldn't open the application window: {e}")
        await close_apply_window()
    return result

# ─── Authentication (Invite Code Gatekeeping) ────────────────────

INVITE_CODES = {
    c.strip() for c in os.getenv("INVITE_CODES", "bertbrainco").split(",") if c.strip()
}
TOKEN_TTL_SECONDS = 30 * 24 * 3600

# Signing key for access tokens. Set AUTH_SECRET in production; the fallback is
# derived from other secrets so tokens survive restarts without extra setup.
AUTH_SECRET = (
    os.getenv("AUTH_SECRET")
    or hashlib.sha256(f"careerflow:{LLM_API_KEY}:{sorted(INVITE_CODES)}".encode()).hexdigest()
).encode()

def _code_tag(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()[:12]

def _sign(payload: str) -> str:
    return hmac.new(AUTH_SECRET, payload.encode(), hashlib.sha256).hexdigest()

def issue_token(code: str) -> str:
    """Signed token: v1.<expiry>.<code tag>.<signature>. Removing a code revokes its tokens."""
    payload = f"v1.{int(time.time()) + TOKEN_TTL_SECONDS}.{_code_tag(code)}"
    return f"{payload}.{_sign(payload)}"

def token_is_valid(token: str) -> bool:
    try:
        version, expiry, tag, signature = token.split(".")
        payload = f"{version}.{expiry}.{tag}"
        return (
            version == "v1"
            and hmac.compare_digest(signature, _sign(payload))
            and int(expiry) > time.time()
            and tag in {_code_tag(c) for c in INVITE_CODES}
        )
    except (ValueError, AttributeError):
        return False

class AuthRequest(BaseModel):
    invite_code: str

@app.post("/api/auth/verify")
async def verify_invite_code(req: AuthRequest):
    """Verify an invite code and return an access token."""
    code = req.invite_code.strip()
    if code in INVITE_CODES:
        return {"token": issue_token(code), "valid": True}
    return {"token": None, "valid": False, "error": "Invalid invite code"}

@app.get("/api/auth/check")
async def check_auth(token: str = ""):
    """Check if the provided token is valid."""
    return {"authenticated": token_is_valid(token)}

# ─── Assisted apply endpoint ─────────────────────────────────────

@app.post("/api/apply")
async def apply_to_job(
    job_url: str = Form(...),
    profile_json: str = Form(None),
    resume_text: str = Form(None),
    resume_json: str = Form(None),
    template: str = Form("ats"),
    job_uuid: str = Form(None),
    job_json: str = Form(None),
):
    """
    Assisted apply: save the tailored resume as a PDF, open the job in a visible browser,
    fill in the candidate's real details and attach the PDF. The candidate submits.
    """
    from resume_render import render_html, render_pdf

    profile = await resolve_profile(profile_json, resume_text)
    missing = [label for label, value in [("name", profile.name), ("email", profile.email), ("phone", profile.phone)]
               if not value.strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Add your {', '.join(missing)} in My details before applying.")
    if not re.match(r"^https?://", job_url or ""):
        raise HTTPException(status_code=400, detail="This job has no application link.")

    resume = _resume_from_form(resume_json) if resume_json else profile_to_resume(profile)
    for key in ("name", "email", "phone", "linkedin", "portfolio", "location"):
        setattr(resume, key, getattr(profile, key))
    out_dir = Path(tempfile.gettempdir()) / "careerflow"
    out_dir.mkdir(exist_ok=True)
    pdf_path = out_dir / f"{re.sub(r'[^A-Za-z0-9]+', '_', profile.name).strip('_') or 'Resume'}_Resume.pdf"
    pdf_path.write_bytes(await render_pdf(render_html(resume, template)))

    return await agent_open_application(job_url, str(pdf_path), profile)

@app.post("/api/apply/close")
async def close_application_window():
    """Close the application browser window (it also closes itself after 20 minutes)."""
    await close_apply_window()
    return {"closed": True}

# ─── Run ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
