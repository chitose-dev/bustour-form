#!/bin/bash
# backend-admin デプロイスクリプト

set -e

PROJECT_ID=${1:-your-gcp-project}
REGION=${2:-asia-northeast1}

echo "📦 backend-admin をデプロイ中..."

gcloud run deploy backend-admin \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars JWT_SECRET=${JWT_SECRET},ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH},LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN},IMGUR_CLIENT_ID=${IMGUR_CLIENT_ID}

ADMIN_URL=$(gcloud run services describe backend-admin --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ backend-admin: $ADMIN_URL"
