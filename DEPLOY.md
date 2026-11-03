# 🚀 Free Deployment Guide (1-10 Users, $0/month)

## Architecture

```
User Browser
    ↓
Vercel (Frontend) — FREE, always on
    ↓ API calls
Render.com (Backend + Playwright) — FREE, sleeps after 15min idle
    ↓
Groq API (AI) — FREE tier
    ↓
MyCareersFuture API + Job Portals (Web Scraping)
```

**Cost: $0/month**

---

## Step 1: Deploy Backend to Render.com

### 1. Create Render Account
Go to https://render.com and sign up (GitHub login works).

### 2. Connect GitHub Repo
1. Push your code to GitHub:
```bash
cd "/Users/yangbertram/Documents/Meta Hackathon/careerflow-sg"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/careerflow-sg.git
git push -u origin main
```

2. On Render: Click "New +" → "Web Service" → Connect your repo

### 3. Configure Backend
| Setting | Value |
|---------|-------|
| **Name** | `careerflow-sg-backend` |
| **Root Directory** | `backend` |
| **Environment** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt && playwright install chromium` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| **Instance Type** | `Free` |
| **Region** | `Singapore` (closest to users) |

### 4. Set Environment Variables
In Render dashboard → "Environment" tab:
```
MODEL_API_KEY=groq-your-actual-key-here
INVITE_CODES=careerflow2026,hackathon,metaai
```

### 5. Deploy
Click "Create Web Service". Wait 5-10 minutes for build + Playwright install.

Your backend URL will be: `https://careerflow-sg-backend-xxxx.onrender.com`

---

## Step 2: Deploy Frontend to Vercel

### 1. Create Vercel Account
Go to https://vercel.com and sign up (GitHub login).

### 2. Import Project
1. Click "Add New Project" → "Import"
2. Select your GitHub repo
3. Framework Preset: **Next.js**
4. Root Directory: `frontend`

### 3. Set Environment Variables
```
NEXT_PUBLIC_API_BASE=https://careerflow-sg-backend-xxxx.onrender.com
```
(Replace with your actual Render URL)

### 4. Deploy
Click "Deploy". Takes ~2 minutes.

Your frontend URL will be: `https://careerflow-sg.vercel.app`

---

## Step 3: Test the Full Flow

1. Visit your Vercel URL
2. Enter an invite code
3. Upload a resume
4. Select job portals (start with just MyCareersFuture for speed)
5. Search jobs → Review → Apply

---

## Important Notes

### Render Free Tier Limits
- **Sleeps after 15 minutes** of inactivity
- **First request after sleep**: ~30-60 seconds to wake up
- **1000 hours/month** (plenty for 1-10 users)
- **512MB RAM** (enough for our use case)

### Workaround for Sleep Delay
Tell your users: "First request might take 30 seconds to warm up. After that, it's fast!"

Or add a "warmup" button that pings `/health` before the actual search.

### Playwright on Render
Playwright browsers are installed during build. The free tier has enough disk space for this.

### Multi-Portal Scraping
- **MyCareersFuture only**: Fast (~5 seconds)
- **All portals**: Slower (~20-40 seconds) due to browser scraping
- **Recommendation**: Default to MyCareersFuture, let users add more portals

---

## Step 4: Share with Users

1. Give them your Vercel URL
2. Give them an invite code
3. They access it like any website — no installation needed

Example message:
```
Hey! Here's CareerFlow SG — your AI career agent.

🔗 Link: https://careerflow-sg.vercel.app
🔑 Invite code: careerflow2026

Upload your resume, find jobs across multiple portals, and one-click apply.
First load might take 30 seconds (server warming up), then it's fast!
```

---

## Scaling to 50 Users (Later)

When you're ready to scale:

1. **Upgrade Render**: $7/month for always-on backend
2. **Add caching**: Redis for job search results
3. **Queue system**: Celery + Redis for concurrent applications
4. **Database**: PostgreSQL for user profiles and application history

---

## Troubleshooting

### Build fails on Render
- Check build logs for Playwright installation errors
- Ensure `playwright install chromium` is in build command

### "Connection refused" from frontend
- Verify `NEXT_PUBLIC_API_BASE` matches your Render URL exactly
- Check Render service is "Live" (not "Sleeping" or "Error")

### Scrapers not finding jobs
- Job portals change their HTML structure frequently
- Check `scrapers.py` selectors and update if needed
- MyCareersFuture API is most reliable

### Groq API rate limit
- Free tier: ~14,400 requests/day (plenty for 1-10 users)
- If hit limit, upgrade to paid tier ($0.90/M tokens)
