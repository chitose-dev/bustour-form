#!/bin/bash
# backend-booking デプロイスクリプト

set -e

PROJECT_ID=${1:-your-gcp-project}
REGION=${2:-asia-northeast1}

echo "📦 backend-booking をデプロイ中..."

gcloud run deploy backend-booking \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN},LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}

BOOKING_URL=$(gcloud run services describe backend-booking --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ backend-booking: $BOOKING_URL"
