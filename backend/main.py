"""
CareerFlow SG — Backend
Autonomous multi-agent career workflow engine for Singapore job seekers.
"""

import os
import json
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

# ─── Configuration ───────────────────────────────────────────────
# Groq API Configuration (Free & Fast)
LLM_API_KEY = os.getenv("MODEL_API_KEY", "")
LLM_BASE_URL = "https://api.groq.com/openai/v1"
MCF_API_BASE = os.getenv("MCF_API_BASE", "https://api.mycareersfuture.gov.sg/v2")
# Llama 3.3 70B was retired on Groq; override with MODEL_ID if the default is retired too.
MODEL_ID = os.getenv("MODEL_ID", "openai/gpt-oss-120b")

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

# Registered before CORS so it runs inside it: unhandled errors come back as JSON
# with CORS headers, instead of a bare 500 the browser reports as "Failed to fetch".
@app.middleware("http")
async def catch_unhandled_errors(request, call_next):
    try:
        return await call_next(request)
    except Exception as e:
        print(f"Unhandled error on {request.url.path}: {e!r}")
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

class GapAnalysis(BaseModel):
    missing_skills: list[dict] = []  # {skill, urgency, courses}
    recommended_courses: list[dict] = []  # {name, provider, duration, cost, skillsfuture_subsidy}
    career_path_suggestions: list[str] = []
    salary_expectation: dict = {}  # {min, max, median, currency}

class ResumeRewrite(BaseModel):
    original_summary: str = ""
    rewritten_summary: str = ""
    optimized_bullets: list[str] = []
    keywords_added: list[str] = []
    ats_score: float = 0.0

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
) -> str:
    """Call the LLM (Groq, OpenAI-compatible chat completions)."""
    if not LLM_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="LLM API key not configured. Set MODEL_API_KEY in .env",
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
            "temperature": 0.7,
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
                    "Authorization": f"Bearer {LLM_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response.status_code == 429 and attempt < 2:
                await asyncio.sleep(_retry_delay(response))
                continue
            if response.status_code == 400 and "json_validate_failed" in response.text and attempt < 1:
                continue
            break

        if response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="The AI service is busy right now. Please wait a minute and try again.",
            )
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
    position_level: Optional[str] = None,
) -> list[JobListing]:
    """Search jobs from MyCareersFuture public API."""
    params = {
        "search": query,
        "limit": min(limit, 100),
        "page": 0,
    }
    if salary_min:
        params["salary"] = salary_min

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{MCF_API_BASE}/jobs", params=params)
        response.raise_for_status()
        data = response.json()

    jobs = []
    for job in data.get("results", [])[:limit]:
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
Return valid JSON matching the schema."""

    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
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

    result = await call_llm_structured(system_prompt, resume_text, schema)
    return ProfileData(**result)

async def agent_match_jobs(
    profile: ProfileData,
    jobs: list[JobListing],
    target_role: str = "",
    target_industry: str = "",
) -> list[JobListing]:
    """Score and rank jobs based on profile match."""
    system_prompt = f"""You are a job matching engine for the Singapore job market.
Target Role: {target_role}
Target Industry: {target_industry}

Given a candidate profile and a list of jobs, score each job on a 0-100 scale based on:
- Skills match (35%): How many required skills does the candidate have?
- Experience match (25%): Does their experience level fit?
- Industry Fit (20%): Does the job align with the target industry and role?
- Career progression (15%): Is this a step up, lateral, or step down?
- Location & logistics (5%): Is the location reasonable?

Return a JSON object with each job's id and its match score."""

    # Compact JSON and short numeric ids (not 32-char UUIDs) keep this call well
    # under the free Groq tier's tokens-per-minute limit.
    profile_summary = json.dumps({
        "skills": profile.skills,
        "experience_years": profile.experience_years,
        "title": profile.title,
        "summary": profile.summary,
    }, separators=(",", ":"))

    jobs_summary = json.dumps([
        {
            "id": i,
            "title": j.title,
            "company": j.company,
            "skills": j.skills[:12],
            "exp": j.experience_required,
            "level": j.position_level,
        }
        for i, j in enumerate(jobs)
    ], separators=(",", ":"))

    user_prompt = f"""Profile:\n{profile_summary}\n\nJobs:\n{jobs_summary}\n\nScore every job and return JSON: {{"scores": [{{"id": 0, "match_score": 0-100}}]}}"""

    schema = {
        "type": "object",
        "properties": {
            "scores": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "match_score": {"type": "number"},
                    },
                    "required": ["id", "match_score"],
                },
            },
        },
        "required": ["scores"],
    }

    result = await call_llm_structured(system_prompt, user_prompt, schema)

    # Apply scores to jobs
    for s in result.get("scores", []):
        try:
            jobs[int(s["id"])].match_score = float(s["match_score"])
        except (KeyError, IndexError, TypeError, ValueError):
            continue

    # Sort by match score descending
    jobs.sort(key=lambda j: j.match_score, reverse=True)
    return jobs

async def agent_gap_analysis(
    profile: ProfileData,
    top_jobs: list[JobListing],
    target_role: str = "",
    target_industry: str = "",
) -> GapAnalysis:
    """Analyze skill gaps and recommend upskilling paths."""
    system_prompt = f"""You are a career development advisor for Singapore.
Target Role: {target_role}
Target Industry: {target_industry}

Analyze the gap between the candidate's profile and their target roles in this industry.
Identify missing skills, recommend specific SkillsFuture-eligible courses,
and suggest career path options. Be specific about course names, providers,
and expected costs with SkillsFuture subsidies."""

    profile_summary = json.dumps({
        "skills": profile.skills,
        "experience_years": profile.experience_years,
        "title": profile.title,
    }, separators=(",", ":"))

    jobs_summary = json.dumps([
        {
            "title": j.title,
            "company": j.company,
            "skills": j.skills[:15],
            "salary_min": j.salary_min,
            "salary_max": j.salary_max,
        }
        for j in top_jobs[:10]
    ], separators=(",", ":"))

    user_prompt = f"""Candidate Profile:\n{profile_summary}\n\nTop Matching Jobs:\n{jobs_summary}\n\nAnalyze gaps and recommend specific upskilling paths for Singapore."""

    schema = {
        "type": "object",
        "properties": {
            "missing_skills": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "skill": {"type": "string"},
                        "urgency": {"type": "string", "enum": ["high", "medium", "low"]},
                        "found_in_jobs": {"type": "integer"},
                        "courses": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "recommended_courses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "provider": {"type": "string"},
                        "duration": {"type": "string"},
                        "estimated_cost": {"type": "number"},
                        "skillsfuture_subsidy": {"type": "string"},
                        "skills_covered": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
            "career_path_suggestions": {"type": "array", "items": {"type": "string"}},
            "salary_expectation": {
                "type": "object",
                "properties": {
                    "min": {"type": "number"},
                    "max": {"type": "number"},
                    "median": {"type": "number"},
                    "currency": {"type": "string"},
                },
            },
        },
        "required": ["missing_skills", "recommended_courses"],
    }

    result = await call_llm_structured(system_prompt, user_prompt, schema)
    return GapAnalysis(**result)

async def agent_rewrite_resume(
    profile: ProfileData,
    target_job: JobListing,
) -> ResumeRewrite:
    """Rewrite resume summary and bullets for a specific target job."""
    system_prompt = """You are an expert resume writer specializing in Singapore's job market.
Rewrite the candidate's resume summary and key achievements to match the target job.
Focus on: ATS optimization (keywords), quantifiable achievements, relevant skills,
and Singapore market expectations. Keep it honest — never fabricate experience."""

    profile_text = f"""Name: {profile.name}
Current Title: {profile.title}
Summary: {profile.summary}
Skills: {', '.join(profile.skills)}
Experience: {profile.experience_years} years
Work History: {json.dumps(profile.work_history, indent=2)}"""

    job_text = f"""Job: {target_job.title} at {target_job.company}
Required Skills: {', '.join(target_job.skills)}
Description: {target_job.description[:2000]}"""

    user_prompt = f"""Candidate Profile:\n{profile_text}\n\nTarget Job:\n{job_text}\n\nRewrite the resume to maximize match with this job."""

    schema = {
        "type": "object",
        "properties": {
            "original_summary": {"type": "string"},
            "rewritten_summary": {"type": "string"},
            "optimized_bullets": {"type": "array", "items": {"type": "string"}},
            "keywords_added": {"type": "array", "items": {"type": "string"}},
            "ats_score": {"type": "number"},
        },
        "required": ["rewritten_summary", "optimized_bullets"],
    }

    result = await call_llm_structured(system_prompt, user_prompt, schema)
    return ResumeRewrite(**result)

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
        "llm_configured": bool(LLM_API_KEY),
        "model": MODEL_ID,
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

@app.post("/api/jobs/match", response_model=list[JobListing])
async def match_jobs(
    query: str = Form("software engineer"),
    limit: int = Form(30),
    resume_text: str = Form(...),
    target_role: str = Form(""),
    target_industry: str = Form(""),
    sources: str = Form("mcf"),  # comma-separated portal sources
):
    """Search jobs and score them against the candidate's profile."""
    # Parse profile first
    profile = await agent_parse_profile(resume_text)

    # Search jobs (single or multi-portal)
    source_list = [s.strip() for s in sources.split(",")] if sources else ["mcf"]
    if "mcf" in source_list and len(source_list) == 1:
        jobs = await search_mcf_jobs(query, limit=limit)
    else:
        from scrapers import scrape_all_portals
        jobs = await scrape_all_portals(query, limit=limit, sources=source_list)

    # Score and rank
    matched = await agent_match_jobs(profile, jobs, target_role=target_role, target_industry=target_industry)

    return matched

@app.post("/api/gap-analysis")
async def gap_analysis(
    query: str = Form("software engineer"),
    resume_text: str = Form(...),
    target_role: str = Form(""),
    target_industry: str = Form(""),
    sources: str = Form("mcf"),
):
    """Analyze skill gaps and recommend upskilling paths."""
    profile = await agent_parse_profile(resume_text)
    
    source_list = [s.strip() for s in sources.split(",")] if sources else ["mcf"]
    if "mcf" in source_list and len(source_list) == 1:
        jobs = await search_mcf_jobs(query, limit=30)
    else:
        from scrapers import scrape_all_portals
        jobs = await scrape_all_portals(query, limit=30, sources=source_list)
    
    # Search results are already relevance-ordered; skipping a second scoring pass
    # halves the LLM tokens this endpoint needs (free tier: 8k tokens/minute).
    gaps = await agent_gap_analysis(profile, jobs, target_role=target_role, target_industry=target_industry)
    return gaps.model_dump()

@app.post("/api/resume/rewrite")
async def rewrite_resume(
    resume_text: str = Form(...),
    job_uuid: str = Form(...),
):
    """Rewrite resume for a specific target job."""
    profile = await agent_parse_profile(resume_text)

    # Fetch the specific job
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{MCF_API_BASE}/jobs/{job_uuid}")
        response.raise_for_status()
        job_data = response.json()

    job = JobListing(
        uuid=job_data.get("uuid", ""),
        title=job_data.get("title", ""),
        company=job_data.get("postedCompany", {}).get("name", ""),
        salary_min=job_data.get("salary", {}).get("minimum"),
        salary_max=job_data.get("salary", {}).get("maximum"),
        salary_type=job_data.get("salary", {}).get("type", {}).get("salaryType", "Monthly"),
        skills=[s.get("skill", "") for s in job_data.get("skills", [])],
        experience_required=job_data.get("minimumYearsExperience", 0) or 0,
        description=job_data.get("description", ""),
    )

    rewrite = await agent_rewrite_resume(profile, job)
    return rewrite.model_dump()

@app.post("/api/interview/prep")
async def interview_prep(
    resume_text: str = Form(...),
    job_uuid: str = Form(...),
):
    """Generate interview preparation materials for a specific job."""
    profile = await agent_parse_profile(resume_text)

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{MCF_API_BASE}/jobs/{job_uuid}")
        response.raise_for_status()
        job_data = response.json()

    job = JobListing(
        uuid=job_data.get("uuid", ""),
        title=job_data.get("title", ""),
        company=job_data.get("postedCompany", {}).get("name", ""),
        salary_min=job_data.get("salary", {}).get("minimum"),
        salary_max=job_data.get("salary", {}).get("maximum"),
        skills=[s.get("skill", "") for s in job_data.get("skills", [])],
        position_level=", ".join(
            p.get("position", "") for p in job_data.get("positionLevels", [])
        ),
    )

    prep = await agent_interview_prep(profile, job)
    return prep.model_dump()

# ─── DOCX Resume Generator ───────────────────────────────────────

async def generate_resume_docx(
    profile: ProfileData,
    rewrite: ResumeRewrite | None = None,
    target_job: JobListing | None = None,
) -> str:
    """Generate a professional DOCX resume file. Returns the file path."""
    doc = Document()
    
    # Title
    title = doc.add_heading(profile.name, level=0)
    title.runs[0].font.color.rgb = None
    
    # Contact line
    doc.add_paragraph(profile.title)
    
    # Summary
    doc.add_heading("Professional Summary", level=1)
    summary_text = rewrite.rewritten_summary if rewrite else profile.summary
    doc.add_paragraph(summary_text)
    
    # Skills
    doc.add_heading("Skills", level=1)
    doc.add_paragraph(", ".join(profile.skills))
    
    # Experience
    doc.add_heading("Work Experience", level=1)
    for job in profile.work_history:
        heading = f"{job.get('role', '')} — {job.get('company', '')}"
        doc.add_heading(heading, level=2)
        doc.add_paragraph(job.get('duration', ''), style='Normal')
        for achievement in job.get('achievements', []):
            doc.add_paragraph(achievement, style='List Bullet')
    
    # Optimized bullets (if rewrite exists)
    if rewrite and rewrite.optimized_bullets:
        doc.add_heading("Key Achievements", level=1)
        for bullet in rewrite.optimized_bullets:
            doc.add_paragraph(bullet, style='List Bullet')
    
    # Education
    if profile.education:
        doc.add_heading("Education", level=1)
        for edu in profile.education:
            doc.add_paragraph(edu, style='List Bullet')
    
    # Certifications
    if profile.certifications:
        doc.add_heading("Certifications", level=1)
        for cert in profile.certifications:
            doc.add_paragraph(cert, style='List Bullet')
    
    # Save to temp file
    fd, path = tempfile.mkstemp(suffix=f"_{profile.name.replace(' ', '_')}_Resume.docx")
    os.close(fd)
    doc.save(path)
    
    return path

# ─── Browser Automation Agent ────────────────────────────────────

async def agent_apply_to_job(
    job_url: str,
    resume_file_path: str,
    profile: ProfileData,
) -> dict:
    """
    Open the job URL in a headless browser, fill the application form,
    upload the resume, and submit.
    
    Returns a status report of what happened.
    """
    result = {
        "status": "started",
        "url": job_url,
        "steps": [],
        "errors": [],
        "success": False,
    }
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=BROWSER_ARGS)
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            page = await context.new_page()
            
            # Step 1: Navigate to job page
            result["steps"].append("Navigating to job page...")
            try:
                await page.goto(job_url, wait_until="domcontentloaded", timeout=30000)
                result["steps"].append(f"Loaded: {page.url}")
            except Exception as e:
                result["errors"].append(f"Failed to load page: {str(e)}")
                await browser.close()
                result["status"] = "failed"
                return result
            
            # Step 2: Look for and click "Apply" button
            result["steps"].append("Looking for Apply button...")
            apply_selectors = [
                'button:has-text("Apply")',
                'button:has-text("Apply Now")',
                'button:has-text("Apply for this job")',
                'a:has-text("Apply")',
                'button[type="submit"]',
                '[data-testid="apply-button"]',
            ]
            
            apply_clicked = False
            for selector in apply_selectors:
                try:
                    btn = await page.wait_for_selector(selector, timeout=3000)
                    if btn:
                        await btn.click()
                        result["steps"].append(f"Clicked apply button ({selector})")
                        apply_clicked = True
                        await page.wait_for_load_state("domcontentloaded", timeout=10000)
                        break
                except Exception:
                    continue
            
            if not apply_clicked:
                result["steps"].append("No apply button found, proceeding with form fill on current page")
            
            # Step 3: Fill common form fields
            result["steps"].append("Filling application form...")
            
            # Name fields
            name_fields = [
                ('input[name="firstName"]', profile.name.split()[0] if profile.name else ""),
                ('input[name="lastName"]', " ".join(profile.name.split()[1:]) if len(profile.name.split()) > 1 else ""),
                ('input[name="first_name"]', profile.name.split()[0] if profile.name else ""),
                ('input[name="last_name"]', " ".join(profile.name.split()[1:]) if len(profile.name.split()) > 1 else ""),
                ('input[name="fullName"]', profile.name),
                ('input[name="full_name"]', profile.name),
                ('input[name="name"]', profile.name),
                ('input[placeholder*="First name" i]', profile.name.split()[0] if profile.name else ""),
                ('input[placeholder*="Last name" i]', " ".join(profile.name.split()[1:]) if len(profile.name.split()) > 1 else ""),
                ('input[placeholder*="Full name" i]', profile.name),
            ]
            
            for selector, value in name_fields:
                try:
                    field = await page.wait_for_selector(selector, timeout=2000)
                    if field and value:
                        await field.fill(value)
                        result["steps"].append(f"Filled: {selector}")
                except Exception:
                    continue
            
            # Email field
            email_selectors = [
                'input[type="email"]',
                'input[name="email"]',
                'input[name="emailAddress"]',
                'input[name="email_address"]',
                'input[placeholder*="email" i]',
            ]
            # Use a generic email based on name
            email = f"{profile.name.lower().replace(' ', '.')}@email.com"
            for selector in email_selectors:
                try:
                    field = await page.wait_for_selector(selector, timeout=2000)
                    if field:
                        await field.fill(email)
                        result["steps"].append(f"Filled email: {selector}")
                        break
                except Exception:
                    continue
            
            # Phone field
            phone_selectors = [
                'input[type="tel"]',
                'input[name="phone"]',
                'input[name="phoneNumber"]',
                'input[name="phone_number"]',
                'input[placeholder*="phone" i]',
            ]
            for selector in phone_selectors:
                try:
                    field = await page.wait_for_selector(selector, timeout=2000)
                    if field:
                        await field.fill("+65 9123 4567")
                        result["steps"].append(f"Filled phone: {selector}")
                        break
                except Exception:
                    continue
            
            # Step 4: Upload resume
            result["steps"].append("Uploading resume...")
            upload_selectors = [
                'input[type="file"]',
                'input[accept*="pdf"]',
                'input[accept*="doc"]',
                'input[accept*="resume"]',
                'input[name="resume"]',
                'input[name="cv"]',
                'input[name="attachment"]',
                'input[name="file"]',
                'input[name="document"]',
            ]
            
            resume_uploaded = False
            for selector in upload_selectors:
                try:
                    file_input = await page.wait_for_selector(selector, timeout=2000)
                    if file_input:
                        await file_input.set_input_files(resume_file_path)
                        result["steps"].append(f"Uploaded resume to: {selector}")
                        resume_uploaded = True
                        await page.wait_for_timeout(2000)  # Wait for upload
                        break
                except Exception:
                    continue
            
            if not resume_uploaded:
                result["errors"].append("Could not find file upload field")
            
            # Step 5: Look for and click Submit
            result["steps"].append("Looking for Submit button...")
            submit_selectors = [
                'button:has-text("Submit")',
                'button:has-text("Submit Application")',
                'button:has-text("Submit Application Now")',
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("Complete Application")',
            ]
            
            submitted = False
            for selector in submit_selectors:
                try:
                    btn = await page.wait_for_selector(selector, timeout=3000)
                    if btn:
                        await btn.click()
                        result["steps"].append(f"Clicked submit: {selector}")
                        submitted = True
                        await page.wait_for_timeout(3000)  # Wait for submission
                        break
                except Exception:
                    continue
            
            # Take screenshot for debugging
            screenshot_path = tempfile.mktemp(suffix="_screenshot.png")
            await page.screenshot(path=screenshot_path)
            result["screenshot"] = screenshot_path
            
            await browser.close()
            
            result["status"] = "completed"
            result["success"] = resume_uploaded and submitted
            if not submitted:
                result["errors"].append("Could not find submit button")
            
    except Exception as e:
        result["status"] = "failed"
        result["errors"].append(f"Browser automation error: {str(e)}")
    
    return result

# ─── Authentication (Invite Code Gatekeeping) ────────────────────

# Simple invite codes - in production, store these in a database
INVITE_CODES = set(os.getenv("INVITE_CODES", "careerflow2026,hackathon,metaai").split(","))

class AuthRequest(BaseModel):
    invite_code: str

@app.post("/api/auth/verify")
async def verify_invite_code(req: AuthRequest):
    """Verify an invite code and return an access token."""
    if req.invite_code in INVITE_CODES:
        # Simple token - in production use JWT
        token = f"cf_{req.invite_code}_{datetime.now().timestamp()}"
        return {"token": token, "valid": True}
    return {"token": None, "valid": False, "error": "Invalid invite code"}

@app.get("/api/auth/check")
async def check_auth(token: str = ""):
    """Check if the provided token is valid."""
    if not token:
        return {"authenticated": False}
    # Extract code from token
    parts = token.split("_")
    if len(parts) >= 2 and parts[1] in INVITE_CODES:
        return {"authenticated": True}
    return {"authenticated": False}

# ─── Agentic Apply Endpoints ─────────────────────────────────────

@app.post("/api/resume/generate-docx")
async def generate_docx(
    resume_text: str = Form(...),
    job_uuid: str = Form(None),
):
    """Generate a downloadable DOCX resume file."""
    profile = await agent_parse_profile(resume_text)
    
    rewrite = None
    target_job = None
    
    if job_uuid:
        # Fetch job and rewrite resume for it
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{MCF_API_BASE}/jobs/{job_uuid}")
            response.raise_for_status()
            job_data = response.json()
        
        target_job = JobListing(
            uuid=job_data.get("uuid", ""),
            title=job_data.get("title", ""),
            company=job_data.get("postedCompany", {}).get("name", ""),
            salary_min=job_data.get("salary", {}).get("minimum"),
            salary_max=job_data.get("salary", {}).get("maximum"),
            skills=[s.get("skill", "") for s in job_data.get("skills", [])],
            description=job_data.get("description", ""),
        )
        
        rewrite = await agent_rewrite_resume(profile, target_job)
    
    file_path = await generate_resume_docx(profile, rewrite, target_job)
    
    return FileResponse(
        path=file_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{profile.name.replace(' ', '_')}_Resume.docx",
    )

@app.post("/api/apply")
async def apply_to_job(
    job_url: str = Form(...),
    resume_text: str = Form(...),
    job_uuid: str = Form(None),
):
    """
    Agentic Apply: Generate optimized resume, then auto-fill and submit the job application.
    This is the holy grail: one click to apply.
    """
    # Step 1: Parse profile
    profile = await agent_parse_profile(resume_text)
    
    # Step 2: Generate optimized DOCX
    target_job = None
    if job_uuid:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{MCF_API_BASE}/jobs/{job_uuid}")
            response.raise_for_status()
            job_data = response.json()
        
        target_job = JobListing(
            uuid=job_data.get("uuid", ""),
            title=job_data.get("title", ""),
            company=job_data.get("postedCompany", {}).get("name", ""),
            skills=[s.get("skill", "") for s in job_data.get("skills", [])],
            description=job_data.get("description", ""),
        )
    
    resume_path = await generate_resume_docx(profile, None, target_job)
    
    # Step 3: Browser automation - fill and submit (one browser at a time)
    async with BROWSER_LOCK:
        result = await agent_apply_to_job(job_url, resume_path, profile)
    
    # Cleanup temp file
    try:
        os.unlink(resume_path)
    except Exception:
        pass
    
    return result

# ─── Run ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
