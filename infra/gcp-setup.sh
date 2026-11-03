#!/usr/bin/env bash
# Deploy the CareerFlow backend to Google Cloud Run with a hard ~$1 spending cap.
#
# Safeguards, in layers:
#   1. Cloud Run limits: max 1 instance, scales to zero, 1 GiB, CPU only during requests.
#   2. A $1 budget scoped to this project, with email alerts at 25/50/90/100%.
#   3. A kill switch: the budget's Pub/Sub messages trigger a function that unlinks
#      billing from the project once cost reaches $1, stopping all paid services.
#   4. The backend rejects API calls without a valid invite-code token.
#
# Usage (after `gcloud auth login` and creating a billing account in the console):
#   PROJECT_ID=careerflow-sg-xxxx BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#   INVITE_CODES="code1,code2" ./infra/gcp-setup.sh
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID (globally unique, e.g. careerflow-sg-1234)}"
: "${BILLING_ACCOUNT:?set BILLING_ACCOUNT (gcloud billing accounts list)}"
: "${INVITE_CODES:?set INVITE_CODES (comma-separated)}"
REGION="${REGION:-asia-southeast1}"
CAP_USD="${CAP_USD:-1}"
SERVICE="${SERVICE:-careerflow-backend}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Project $PROJECT_ID in $REGION, cap \$$CAP_USD"
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || gcloud projects create "$PROJECT_ID" --name="CareerFlow SG"
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudfunctions.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  secretmanager.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com

echo "==> Kill switch (budget -> Pub/Sub -> function that disables billing)"
gcloud pubsub topics describe billing-alerts >/dev/null 2>&1 || gcloud pubsub topics create billing-alerts
KILL_SA="billing-killswitch@$PROJECT_ID.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$KILL_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create billing-killswitch --display-name="Billing kill switch"
# Project Billing Manager is enough to unlink billing from this one project
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$KILL_SA" \
  --role=roles/billing.projectManager --condition=None >/dev/null
gcloud functions deploy billing-killswitch --gen2 --runtime=python312 --region="$REGION" \
  --source="$ROOT/infra/billing-killswitch" --entry-point=stop_billing \
  --trigger-topic=billing-alerts --service-account="$KILL_SA" \
  --set-env-vars="TARGET_PROJECT_ID=$PROJECT_ID,CAP_USD=$CAP_USD" \
  --memory=256Mi --max-instances=1 --quiet

echo "==> \$$CAP_USD budget with alerts"
if ! gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" --format='value(displayName)' | grep -qx "CareerFlow cap"; then
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" --display-name="CareerFlow cap" \
    --budget-amount="${CAP_USD}USD" --filter-projects="projects/$PROJECT_ID" \
    --threshold-rule=percent=0.25 --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
    --notifications-rule-pubsub-topic="projects/$PROJECT_ID/topics/billing-alerts"
fi

echo "==> Secrets"
RUN_SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
upsert_secret() {  # name, value (read from stdin so it never appears in argv)
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  fi
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$RUN_SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
}
grep '^MODEL_API_KEY=' "$ROOT/backend/.env" | cut -d= -f2- | tr -d '\n' | upsert_secret groq-api-key
gcloud secrets describe auth-secret >/dev/null 2>&1 || openssl rand -hex 32 | tr -d '\n' | upsert_secret auth-secret
printf '%s' "$INVITE_CODES" | upsert_secret invite-codes

echo "==> Cloud Run (hard limits)"
# Cloud Build in new projects runs as the compute service account
for role in roles/run.builder roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" \
    --role="$role" --condition=None >/dev/null
done
gcloud run deploy "$SERVICE" --source="$ROOT/backend" --region="$REGION" \
  --allow-unauthenticated --memory=1Gi --cpu=1 --min-instances=0 --max-instances=1 \
  --concurrency=4 --timeout=300 --cpu-throttling \
  --set-secrets="MODEL_API_KEY=groq-api-key:latest,AUTH_SECRET=auth-secret:latest,INVITE_CODES=invite-codes:latest" \
  --quiet

echo "==> Keep only the 2 newest images (Artifact Registry storage is billed past 0.5 GB)"
cat > /tmp/careerflow-ar-policy.json <<'JSON'
[{"name": "keep-2-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 2}},
 {"name": "delete-rest", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}]
JSON
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy --location="$REGION" \
  --policy=/tmp/careerflow-ar-policy.json --no-dry-run --quiet

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo "==> Done. Backend: $URL"
echo "    Set NEXT_PUBLIC_API_BASE=$URL in Vercel and redeploy the frontend."
