# CareerFlow SG 🇸🇬

**Autonomous Career Agent for Singapore** — Upload resume → Find jobs → One-click apply.

## What It Does

1. **Upload** your resume (PDF/TXT)
2. **Discover** matching jobs from MyCareersFuture (80k+ jobs)
3. **Analyze** skill gaps with SkillsFuture course recommendations
4. **Rewrite** your resume optimized for each specific job
5. **Apply** — one click to auto-fill forms, upload resume, and submit

## How Users Access It

Users visit your deployed website URL. They enter an **invite code** to access the app. No installation needed.

```
User → Visits careerflow-sg.com → Enters invite code → Full access
```

## Quick Start (Local Development)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium  # Install browser for automation
cp .env.example .env        # Configure your API key & invite codes
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local  # Set NEXT_PUBLIC_API_BASE
npm run dev
```

Visit `http://localhost:3000`

## Deployment

### Option 1: Simple VPS (Recommended for ~50 users)
1. Rent a VPS (DigitalOcean, AWS Lightsail, etc.) — ~$10/month
2. Install Python 3.11+, Node.js 20+
3. Clone repo, install dependencies
4. Run backend with `uvicorn main:app --host 0.0.0.0 --port 8000`
5. Build frontend with `npm run build` and serve with `npm start`
6. Put behind Nginx + Let's Encrypt SSL

### Option 2: Cloud Platforms
- **Backend**: Render.com, Railway.app, or Fly.io (Free tiers available)
- **Frontend**: Vercel, Netlify (Free tiers available)

### Option 3: Docker
```bash
# Backend
docker build -f backend/Dockerfile -t careerflow-backend .
docker run -p 8000:8000 --env-file backend/.env careerflow-backend

# Frontend  
docker build -f frontend/Dockerfile -t careerflow-frontend .
docker run -p 3000:3000 careerflow-frontend
```

## Gatekeeping (Invite Codes)

Set invite codes in `.env`:
```
INVITE_CODES=code1,code2,code3
```

Users enter any of these codes to access the app. Tokens are stored in localStorage.

## API Keys

- **Groq API Key**: Free tier gives you access to Llama 3.3 70B. Get it at https://console.groq.com/
- **MyCareersFuture**: Public API, no key needed

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4
- **Backend**: FastAPI, Python 3.11+
- **AI**: Groq Llama 3.3 70B (free)
- **Browser Automation**: Playwright
- **Data**: MyCareersFuture SG API

## License

© 2026 CareerFlow SG. All rights reserved.
