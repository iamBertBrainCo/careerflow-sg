# CareerFlow SG — Getting Started Guide

## What You Have

A complete, working prototype of an autonomous career workflow engine for Singapore:

```
careerflow-sg/
├── README.md           # Project overview
├── setup.sh            # One-command setup script
├── backend/            # Python FastAPI backend
│   ├── main.py         # Core engine: Groq LLM + MyCareersFuture integration
│   ├── requirements.txt# Python dependencies
│   └── .env.example    # Environment variables template
└── frontend/           # Next.js + Tailwind frontend
    ├── src/app/        # React pages and components
    └── .env.local      # Frontend environment variables
```

## Step 1: Get a Groq API Key (Free)

This is the **only thing you need to do manually**:

1. Go to **https://console.groq.com/keys**
2. Sign in or create an account
3. Click **Create API Key** and copy it (it starts with `gsk_`)

The free tier includes GPT-OSS 120B, which is what CareerFlow uses.

## Step 2: Run the Setup

```bash
cd careerflow-sg

# Run the setup script
chmod +x setup.sh
./setup.sh
```

## Step 3: Add Your API Key

```bash
# Edit the backend .env file
nano backend/.env
# Or use any text editor

# Change this line:
MODEL_API_KEY=your-groq-api-key-here
# To:
MODEL_API_KEY=gsk_your-actual-key-here
```

## Step 4: Start the Servers

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn main:app --reload --port 8000
```
You should see: `INFO: Uvicorn running on http://0.0.0.0:8000`

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```
You should see: `✓ Ready in Xms` → Open **http://localhost:3000**

## Step 5: Try It

1. Open http://localhost:3000
2. Upload a resume (PDF or paste text)
3. Click "Analyze My Profile"
4. Search for jobs
5. See skill gaps, recommended courses, resume rewrites, interview prep

## How It Works

### The 5-Step Workflow

| Step | What Happens | What the AI Does |
|------|-------------|--------------|
| **Profile** | Parse resume → structured data | GPT-OSS 120B extracts skills, experience, education |
| **Discover** | Search 80K+ SG jobs, score matches | GPT-OSS 120B scores each job against your profile (0-100) |
| **Gap Analysis** | Find missing skills, recommend courses | GPT-OSS 120B compares profile vs market, suggests SkillsFuture courses |
| **Prepare** | Rewrite resume for specific job | GPT-OSS 120B optimizes for ATS, adds keywords, rewrites bullets |
| **Interview** | Generate mock questions + company research | GPT-OSS 120B creates behavioral/technical questions, STAR framework hints |

### Data Sources

- **MyCareersFuture API** (`api.mycareersfuture.gov.sg`) — Public, free, no auth. 80K+ job listings with salary, skills, company data.
- **Groq API** (`api.groq.com`) — GPT-OSS 120B for all AI processing.

## Troubleshooting

### "LLM API error: 401"
Your API key isn't set or is invalid. Check `backend/.env` and make sure `MODEL_API_KEY` starts with `gsk_`.

### "Connection refused" on port 8000
The backend isn't running. Start it with `uvicorn main:app --reload --port 8000`.

### Frontend can't connect to backend
Make sure `frontend/.env.local` has `NEXT_PUBLIC_API_BASE=http://localhost:8000`.

### CORS errors
The backend already has CORS enabled for all origins. Make sure both servers are running.

## Next Steps (If You Have More Time)

- [ ] Add voice interview practice
- [ ] Generate visual resume designs
- [ ] LinkedIn outreach automation
- [ ] Application tracking Kanban board
- [ ] Email integration for cover letter sending
