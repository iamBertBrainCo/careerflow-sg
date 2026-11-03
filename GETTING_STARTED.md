# CareerFlow SG — Getting Started Guide

## What You Have

A complete, working prototype of an autonomous career workflow engine for Singapore:

```
careerflow-sg/
├── README.md           # Project overview
├── setup.sh            # One-command setup script
├── backend/            # Python FastAPI backend
│   ├── main.py         # Core engine: Meta API + MyCareersFuture integration
│   ├── requirements.txt# Python dependencies
│   └── .env.example    # Environment variables template
└── frontend/           # Next.js + Tailwind frontend
    ├── src/app/        # React pages and components
    └── .env.local      # Frontend environment variables
```

## Step 1: Get Your Meta API Key (Free)

This is the **only thing you need to do manually**:

1. Go to **https://dev.meta.ai**
2. Sign in (use your Meta/Facebook account or create one)
3. Go to **Dashboard** → **API Keys** → **Create API Key**
4. Copy the key (it looks like `mk-...`)

> **Note**: If you're registered for the hackathon, you get **$150 in free credits**. This prototype will use a fraction of that.

## Step 2: Run the Setup

```bash
cd "/Users/yangbertram/Documents/Random Question/careerflow-sg"

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
MODEL_API_KEY=your-meta-api-key-here
# To:
MODEL_API_KEY=mk-your-actual-key-here
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

| Step | What Happens | Meta AI Does |
|------|-------------|--------------|
| **Profile** | Parse resume → structured data | Muse Spark extracts skills, experience, education |
| **Discover** | Search 80K+ SG jobs, score matches | Muse Spark scores each job against your profile (0-100) |
| **Gap Analysis** | Find missing skills, recommend courses | Muse Spark compares profile vs market, suggests SkillsFuture courses |
| **Prepare** | Rewrite resume for specific job | Muse Spark optimizes for ATS, adds keywords, rewrites bullets |
| **Interview** | Generate mock questions + company research | Muse Spark creates behavioral/technical questions, STAR framework hints |

### Data Sources

- **MyCareersFuture API** (`api.mycareersfuture.gov.sg`) — Public, free, no auth. 80K+ job listings with salary, skills, company data.
- **Meta Model API** (`api.meta.ai`) — Muse Spark 1.3 for all AI processing.
- **Meta Web Search** — Built into the API for real-time company research.

## Troubleshooting

### "Meta API error: 401"
Your API key isn't set or is invalid. Check `backend/.env` and make sure `MODEL_API_KEY` starts with `mk-`.

### "Connection refused" on port 8000
The backend isn't running. Start it with `uvicorn main:app --reload --port 8000`.

### Frontend can't connect to backend
Make sure `frontend/.env.local` has `NEXT_PUBLIC_API_BASE=http://localhost:8000`.

### CORS errors
The backend already has CORS enabled for all origins. Make sure both servers are running.

## For the Hackathon Submission

### What to Include
1. **GitHub repo** with this code
2. **Demo video** (2-3 min) showing the full workflow
3. **Write-up** explaining:
   - Problem: Fragmented job hunting in Singapore
   - Solution: Autonomous multi-agent workflow
   - Meta tools used: Muse Spark 1.3, tool calling, web search, 1M token context
   - Data sources: MyCareersFuture public API
   - Impact: End-to-end job search, from resume to offer

### What Makes This Stand Out
- **Real data**: Live integration with Singapore's government job portal (80K+ listings)
- **Real workflow**: Not a chatbot — actually executes the career pipeline
- **Meta-specific**: Uses Muse Spark's unique capabilities (multi-agent, 1M context, tool calling)
- **Local impact**: SkillsFuture course recommendations, SG salary data, local market context

## Next Steps (If You Have More Time)

- [ ] Add voice interview practice (Muse Voice Transcribe)
- [ ] Generate visual resume designs (Muse Image)
- [ ] LinkedIn outreach automation
- [ ] Application tracking Kanban board
- [ ] Email integration for cover letter sending
- [ ] Mobile-responsive design polish

---

**Built for the Meta Global AI Developer Hackathon 2026** 🦙
Indie Developer Track · Build for Your World
