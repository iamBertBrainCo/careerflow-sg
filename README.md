# CareerFlow SG 🇸🇬

**Your AI career copilot for Singapore, running on your own computer.**
Upload your resume, find jobs that fit, see your skill gaps against SkillsFuture's Skills
Framework, tailor an ATS-friendly resume for each job, prepare for interviews, and apply.

Developed by **[Bertram Yang](https://www.linkedin.com/in/bertramyang)**.

---

## What it does

| Step | What happens |
|---|---|
| **1. Profile** | Upload a PDF/TXT resume (or paste it). The AI reads it into a profile you can check and edit, including **My details** (name, email, phone, LinkedIn). Saved only in your browser. |
| **2. Discover** | Searches ~200 live MyCareersFuture listings (plus JobStreet, optional), filtered by salary and employment type. Every job is ranked in code on title, skills, experience and salary; the top 15 are then reviewed by AI, which explains each match. Select up to 5 jobs. |
| **3. Skill gaps** *(optional)* | Matches your target to an official **SkillsFuture Skills Framework** role, then shows each skill and competency that role needs, the level required, whether you have it, why it matters, and how to build it, with links to MySkillsFuture courses. |
| **4. Tailor resumes** | One click tailors a resume for every selected job using ATS rules. Choose from 7 templates, edit everything with a live preview, watch the ATS score update, and download PDF or Word. **The AI never invents experience**: job keywords you don't have are shown as suggestions you can add only if true. |
| **5. Interview** | Likely behavioural and technical questions, company research and salary tips for each job. |
| **Apply** | Opens the job in a visible browser window, fills in your real details and attaches your tailored resume. **It never submits**: you check the form and press Submit yourself. |

Everything runs on your computer. Your resume and details are only sent to the AI provider
you choose (to read and rewrite them) and, when you apply, to the job site you open.

---

## What you need

- **Python 3.10 or newer**: [python.org/downloads](https://www.python.org/downloads/) (macOS: `brew install python@3.12`)
- **Node.js 20 or newer**: [nodejs.org](https://nodejs.org) (the LTS version)
- **A free AI API key**: see [Choosing an AI provider](#choosing-an-ai-provider). Groq is the easiest.
- About 1 GB of disk space (the app, Python and Node packages, and a browser for PDFs)

## Setup (macOS / Linux)

```bash
git clone https://github.com/iamBertBrainCo/careerflow-sg.git
cd careerflow-sg
./setup.sh
```

The script checks Python and Node, installs everything, downloads SkillsFuture's Skills
Framework data, and creates your settings file `backend/.env`.

Then **open `backend/.env`** in any text editor and paste your key after `MODEL_API_KEY=`.

## Start the app

```bash
./start.sh
```

Open **http://localhost:3000** and sign in with the invite code **`bertbrainco`**
(change it with `INVITE_CODES=` in `backend/.env`). Press `Ctrl+C` in the terminal to stop.

## Setup and start on Windows

Use PowerShell in the `careerflow-sg` folder:

```powershell
# One-time setup
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements.txt
backend\.venv\Scripts\playwright install chromium
backend\.venv\Scripts\python backend\data\build_skills_framework.py --download
npm install
copy backend\.env.example backend\.env
notepad backend\.env      # paste your key after MODEL_API_KEY=
```

```powershell
# Start (two PowerShell windows)
cd backend; .venv\Scripts\uvicorn main:app --port 8000     # window 1
npm --prefix frontend run dev                               # window 2
```

---

## Choosing an AI provider

CareerFlow works with any **OpenAI-compatible** AI API. `backend/.env.example` has a
ready-made block for each option below: keep one, paste your key, restart the backend.

| Provider | Cost | Get a key | Notes |
|---|---|---|---|
| **Groq** (default) | Free tier | [console.groq.com/keys](https://console.groq.com/keys) | Fast. Free tier allows ~8,000 tokens a minute, so some steps pause ~20 s and retry by themselves. |
| **Google Gemini** | Free tier | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Check [current model names](https://ai.google.dev/gemini-api/docs/models). |
| **OpenRouter** | Some models free | [openrouter.ai/keys](https://openrouter.ai/keys) | Free models end in `:free`. |
| **Ollama** | Free, offline | No key | Runs on your laptop ([ollama.com](https://ollama.com)). Slower; needs 16 GB+ memory. |

Free tiers and model names change; check the provider's page on the day.

---

## How it works (for the curious)

```
frontend/  Next.js app (http://localhost:3000)
  src/app/page.tsx              the five steps
  src/components/               ProfileEditor, SkillGaps, TailorWorkspace, ResumeEditor, ResumePreview
backend/   FastAPI server (http://localhost:8000)
  main.py                       API endpoints and the AI prompts
  matching.py                   job ranking in plain code (title / skills / experience / salary)
  skills_gap.py                 SkillsFuture Skills Framework role matching and skill lists
  resume_render.py              fills resume templates -> HTML preview, PDF, Word; ATS checks
  resume_templates/             7 HTML resume templates
  data/build_skills_framework.py  downloads and converts the Skills Framework dataset
```

Design choices worth discussing in a workshop:
- **Code first, AI second.** Ranking, skill lists, salaries and ATS checks are plain code: fast,
  free and explainable. The AI is used where language matters (reading resumes, explaining
  matches and gaps, rewriting bullets).
- **Guardrails in code, not just prompts.** After tailoring, code removes any bullet or skill the
  AI added that isn't backed by your own profile.
- **Small prompts** (compact JSON, short IDs, top-N only) so free API tiers are enough.

## Troubleshooting

| Problem | Fix |
|---|---|
| Yellow "Setup needed" box in the app | Follow what it says: usually the AI key in `backend/.env`, then restart. |
| "Your AI provider rejected the key" | Re-copy the key into `backend/.env` (no spaces or quotes), then restart. |
| "The model ... wasn't found" | Update `MODEL_ID` in `backend/.env` to a model your provider lists. |
| "The AI service is busy" | Free-tier limit. Wait a minute and try again. |
| "We couldn't reach the CareerFlow server" | The backend isn't running. Start it with `./start.sh`. |
| JobStreet returns few jobs; Indeed / LinkedIn / Glassdoor return none | Those sites block automated browsers. MyCareersFuture is the reliable source. |
| Apply finds no form | Many sites (including MyCareersFuture) need you to sign in first: sign in in the opened window, then apply. |

## Credits

- Resume templates and ATS rules from **[sg-job-hunter](https://github.com/iamBertBrainCo/sg-job-hunter)** by Bertram Yang (MIT).
- Job listings from **MyCareersFuture**'s public API.
- Skills and competencies from **SkillsFuture Singapore's Skills Framework**
  ([jobsandskills.swda.gov.sg](https://jobsandskills.swda.gov.sg/frameworks/skills-frameworks)).
  The dataset is downloaded to your computer during setup and is not included in this repo.

© 2026 Bertram Yang.
