"""
Resume rendering: one structured resume (ResumeDoc) -> HTML preview, PDF, or Word.

Templates live in resume_templates/ (from sg-job-hunter, MIT). Each is an HTML page
with {{PLACEHOLDERS}}; we fill them and drop any section with no content, heading
included, which is one of the ATS rules in sg-job-hunter's ats-rules.yml.

ats_check() scores a resume against those rules plus the target job's keywords.
"""

import html
import io
import re
from pathlib import Path

from pydantic import BaseModel

TEMPLATE_DIR = Path(__file__).parent / "resume_templates"

# name -> (label, ATS-safe?). Safety measured in sg-job-hunter's ats-rules.yml:
# modern/jake/leadership fragment headings under ATS text extraction.
TEMPLATES = {
    "ats": ("ATS Plain", True),
    "standard": ("Standard", True),
    "compact": ("Compact", True),
    "executive": ("Executive", True),
    "modern": ("Modern", False),
    "jake": ("Jake", False),
    "leadership": ("Leadership", False),
}


class ExperienceEntry(BaseModel):
    company: str = ""
    role: str = ""
    location: str = ""
    period: str = ""
    bullets: list[str] = []


class EducationEntry(BaseModel):
    title: str = ""   # e.g. "Diploma in Business"
    org: str = ""     # e.g. "Ngee Ann Polytechnic"
    year: str = ""


class CertificationEntry(BaseModel):
    title: str = ""
    org: str = ""
    year: str = ""


class SkillGroup(BaseModel):
    category: str = ""
    items: list[str] = []


class ResumeDoc(BaseModel):
    name: str = ""
    title: str = ""
    email: str = ""
    phone: str = ""
    linkedin: str = ""
    portfolio: str = ""
    location: str = ""
    summary: str = ""
    competencies: list[str] = []
    experience: list[ExperienceEntry] = []
    education: list[EducationEntry] = []
    certifications: list[CertificationEntry] = []
    skills: list[SkillGroup] = []


def list_templates() -> list[dict]:
    return [{"id": k, "label": label, "ats_safe": safe} for k, (label, safe) in TEMPLATES.items()]


def _e(value: str) -> str:
    return html.escape(value or "", quote=True)


def _url(value: str) -> str:
    v = (value or "").strip()
    if v and not re.match(r"^(https?:|mailto:|tel:)", v):
        v = "https://" + v
    return v


def _display(value: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", (value or "").strip()).rstrip("/")


def _drop_section(page: str, token: str) -> str:
    """Remove the whole <div class="section"> whose heading is {{token}}."""
    pattern = (
        r'<div class="section">\s*<div class="section-title">\{\{' + token + r'\}\}</div>'
        r'.*?(?=<div class="section">|<div class="cv-consent">|</div>\s*</body>)'
    )
    return re.sub(pattern, "", page, flags=re.S)


def render_html(doc: ResumeDoc, template: str = "standard") -> str:
    if template not in TEMPLATES:
        template = "standard"
    page = (TEMPLATE_DIR / f"{template}.html").read_text(encoding="utf-8")
    # Some templates carry metadata after a comment that closes too early
    # ("<!-- ... --> name: ... -->"); drop everything before <html> so it never shows
    page = "<!DOCTYPE html>\n" + page[page.find("<html"):]
    page = re.sub(r"<!--.*?-->", "", page, flags=re.S)

    experience = "".join(
        '<div class="job"><div class="job-header">'
        f'<span class="job-company">{_e(j.company)}</span>'
        f'<span class="job-period">{_e(j.period)}</span></div>'
        f'<div class="job-role">{_e(j.role)}</div>'
        + (f'<div class="job-location">{_e(j.location)}</div>' if j.location else "")
        + ("<ul>" + "".join(f"<li>{_e(b)}</li>" for b in j.bullets if b.strip()) + "</ul>" if any(b.strip() for b in j.bullets) else "")
        + "</div>"
        for j in doc.experience if j.company or j.role
    )
    education = "".join(
        f'<div class="edu-item"><div class="edu-header"><span class="edu-title">{_e(ed.title)}</span>'
        f'<span class="edu-year">{_e(ed.year)}</span></div><div class="edu-org">{_e(ed.org)}</div></div>'
        for ed in doc.education if ed.title or ed.org
    )
    certifications = "".join(
        f'<div class="cert-item"><span class="cert-title">{_e(c.title)}</span>'
        f'<span class="cert-org">{_e(c.org)}</span><span class="cert-year">{_e(c.year)}</span></div>'
        for c in doc.certifications if c.title
    )
    tag_class = "competency-item" if template == "ats" else "competency-tag"
    competencies = "".join(f'<span class="{tag_class}">{_e(c)}</span>' for c in doc.competencies if c.strip())
    skills_rows = "".join(
        '<div class="skill-item">'
        + (f'<span class="skill-category">{_e(g.category)}:</span> ' if g.category else "")
        + _e(", ".join(i for i in g.items if i.strip())) + "</div>"
        for g in doc.skills if any(i.strip() for i in g.items)
    )
    skills = f'<div class="skills-grid">{skills_rows}</div>' if skills_rows and "skills-grid" in page else skills_rows

    sections = {
        "SUMMARY": ("Professional Summary", doc.summary.strip()),
        "COMPETENCIES": ("Core Competencies", competencies),
        "EXPERIENCE": ("Work Experience", experience),
        "PROJECTS": ("Projects", ""),
        "EDUCATION": ("Education", education),
        "CERTIFICATIONS": ("Certifications", certifications),
        "AWARDS": ("Awards & Honors", ""),
        "INTERESTS": ("Interests", ""),
        "SKILLS": ("Skills", skills),
    }
    for key, (_, content) in sections.items():
        if not content:
            page = _drop_section(page, f"SECTION_{key}")

    values = {
        "LANG": "en",
        "NAME": _e(doc.name or "Your Name"),
        "TITLE_BLOCK": f'<div class="header-title">{_e(doc.title)}</div>' if doc.title else "",
        "PHONE": _e(doc.phone),
        "EMAIL": _e(doc.email),
        "LINKEDIN_URL": _e(_url(doc.linkedin)),
        "LINKEDIN_DISPLAY": _e(_display(doc.linkedin)),
        "PORTFOLIO_URL": _e(_url(doc.portfolio)),
        "PORTFOLIO_DISPLAY": _e(_display(doc.portfolio)),
        "LOCATION": _e(doc.location),
        "PHOTO": "",
        "CONSENT": "",
        "SUMMARY_TEXT": _e(doc.summary),
        "COMPETENCIES": competencies,
        "EXPERIENCE": experience,
        "PROJECTS": "",
        "EDUCATION": education,
        "CERTIFICATIONS": certifications,
        "AWARDS": "",
        "INTERESTS": "",
        "SKILLS": skills,
        "PAGE_WIDTH": "8.27in",
    }
    for key, (heading, _) in sections.items():
        values[f"SECTION_{key}"] = heading
    page = re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: values.get(m.group(1), ""), page)
    # Contact links with nothing in them (e.g. no portfolio) would leave stray separators
    page = re.sub(r'<a href="[^"]*">\s*</a>', "", page)
    page = re.sub(r"<span>\s*</span>", "", page)
    return page


async def render_pdf(page_html: str) -> bytes:
    """Print the rendered HTML to an A4 PDF with the local headless Chromium."""
    from playwright.async_api import async_playwright
    from main import BROWSER_ARGS, BROWSER_LOCK

    async with BROWSER_LOCK:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=BROWSER_ARGS)
            try:
                page = await browser.new_page()
                await page.set_content(page_html, wait_until="load")
                return await page.pdf(format="A4", print_background=True, prefer_css_page_size=True)
            finally:
                await browser.close()


def render_docx(doc: ResumeDoc) -> bytes:
    """A plain, single-column Word version (the most ATS-friendly format)."""
    from docx import Document
    from docx.shared import Pt

    d = Document()
    style = d.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(10.5)

    title = d.add_heading(doc.name or "Your Name", level=0)
    for run in title.runs:
        run.font.color.rgb = None
    if doc.title:
        d.add_paragraph(doc.title)
    contact = " | ".join(x for x in [doc.location, doc.phone, doc.email, _display(doc.linkedin), _display(doc.portfolio)] if x)
    if contact:
        d.add_paragraph(contact)

    def heading(text: str):
        h = d.add_heading(text, level=1)
        for run in h.runs:
            run.font.color.rgb = None

    if doc.summary.strip():
        heading("Professional Summary")
        d.add_paragraph(doc.summary.strip())
    if doc.competencies:
        heading("Core Competencies")
        d.add_paragraph(" • ".join(doc.competencies))
    if doc.experience:
        heading("Work Experience")
        for j in doc.experience:
            p = d.add_paragraph()
            p.add_run(j.role or "").bold = True
            if j.company:
                p.add_run(f" — {j.company}")
            if j.location:
                p.add_run(f", {j.location}")
            if j.period:
                p.add_run(f"  ({j.period})")
            for b in j.bullets:
                if b.strip():
                    d.add_paragraph(b.strip(), style="List Bullet")
    if doc.education:
        heading("Education")
        for ed in doc.education:
            d.add_paragraph(" — ".join(x for x in [ed.title, ed.org, ed.year] if x))
    if doc.certifications:
        heading("Certifications")
        for c in doc.certifications:
            d.add_paragraph(" — ".join(x for x in [c.title, c.org, c.year] if x), style="List Bullet")
    if any(g.items for g in doc.skills):
        heading("Skills")
        for g in doc.skills:
            if g.items:
                d.add_paragraph((f"{g.category}: " if g.category else "") + ", ".join(g.items))

    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# ─── ATS check ───────────────────────────────────────────────────

WEAK_STARTS = {"responsible", "responsibilities", "helped", "assisted", "worked", "tasked", "duties", "involved", "i", "my", "we"}
FIRST_PERSON = re.compile(r"\b(I|me|my|mine|myself)\b")


def ats_check(doc: ResumeDoc, job_keywords: list[str], template: str) -> dict:
    """Score the resume 0-100 against ATS rules and the job's keywords; explain each check."""
    from matching import normalize, skill_variants

    bullets = [b.strip() for j in doc.experience for b in j.bullets if b.strip()]
    text = normalize(" ".join([doc.title, doc.summary, " ".join(doc.competencies), " ".join(bullets),
                               " ".join(i for g in doc.skills for i in g.items)]))
    checks = []

    def add(id_, label, passed, detail, weight):
        checks.append({"id": id_, "label": label, "passed": bool(passed), "detail": detail, "weight": weight})

    missing_contact = [k for k in ("name", "email", "phone") if not getattr(doc, k).strip()]
    add("contact", "Contact details in the body", not missing_contact,
        "Name, email and phone are present." if not missing_contact else f"Missing: {', '.join(missing_contact)}. Add them in My details.", 15)

    safe = TEMPLATES.get(template, ("", True))[1]
    add("template", "ATS-safe template", safe,
        "Single column with standard headings that ATS software reads cleanly." if safe else
        "This design can split headings into separate letters when an ATS extracts the text. Use an ATS-safe template for online applications.", 10)

    kws = [k for k in dict.fromkeys(k.strip() for k in job_keywords) if k]
    hits = [k for k in kws if any(f" {v} " in text for v in skill_variants(k))]
    coverage = len(hits) / len(kws) if kws else 1.0
    add("keywords", "Job keywords covered", coverage >= 0.5,
        f"{len(hits)} of {len(kws)} key terms from the job appear in your resume." + (
            f" Not yet covered: {', '.join([k for k in kws if k not in hits][:6])}." if len(hits) < len(kws) else ""), 25)

    weak = [b for b in bullets if (b.split()[0].lower().strip(",.:;") if b.split() else "") in WEAK_STARTS]
    add("verbs", "Bullets start with action verbs", bullets and not weak,
        "Every bullet opens with an action verb." if bullets and not weak else
        ("Add achievement bullets to your experience." if not bullets else f"{len(weak)} bullet(s) open weakly, e.g. \"{weak[0][:60]}\"."), 15)

    with_numbers = [b for b in bullets if re.search(r"\d", b)]
    share = len(with_numbers) / len(bullets) if bullets else 0
    add("metrics", "Results are measurable", share >= 0.4,
        f"{len(with_numbers)} of {len(bullets)} bullets include a number (%, $, count, time). Aim for at least 40%, but only with real figures.", 15)

    long_bullets = [b for b in bullets if len(b.split()) > 32]
    add("length", "Bullets are concise", not long_bullets,
        "All bullets are short enough to scan." if not long_bullets else f"{len(long_bullets)} bullet(s) run over 32 words; split or trim them.", 5)

    fp = FIRST_PERSON.search(" ".join([doc.summary] + bullets))
    add("voice", "No first-person pronouns", not fp,
        "Written in the implied first person, as resumes should be." if not fp else f"Remove words like \"{fp.group(0)}\".", 5)

    words = len(doc.summary.split())
    add("summary", "Summary is a good length", 25 <= words <= 90,
        f"Summary is {words} words; aim for about 30-80.", 10)

    score = round(sum(c["weight"] for c in checks if c["passed"]) / sum(c["weight"] for c in checks) * 100)
    return {"score": score, "checks": checks, "keywords_hit": hits, "keywords_missing": [k for k in kws if k not in hits]}
