# CareerFlow SG backend (FastAPI + Playwright Chromium), built for Cloud Run
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_ROOT_USER_ACTION=ignore

WORKDIR /app

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Chromium plus exactly the system libraries it needs on this Debian release
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Application code (.dockerignore keeps .env and venv out of the image)
COPY . .

# Cloud Run sets $PORT (default 8080); Render and local runs can override it
CMD exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}"
