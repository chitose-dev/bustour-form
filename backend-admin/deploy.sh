#!/bin/bash
# backend-admin デプロイスクリプト

set -e

PROJECT_ID="tourreserve"
REGION="asia-northeast1"
SERVICE_NAME="backend-admin-v2"

# LINE 関連の設定（Cloud Run環境変数用）
LINE_CHANNEL_TOKEN="7VPCSNBWd0vNEfz2VjS8sUULmmn03iFSOkii4BPy4x6VtstE3Rzr2GsZAMy/PDkeiXIrau1DFqfrxtRuSc+5SkR6F682S6r/afFOEliyR7qN5ltkANsHihzjnIPJ7hzEuea1EcTdzR3cYeeScLgH/QdB04t89/1O/w1cDnyilFU="
LINE_CHANNEL_SECRET="c564acbcf01b421d01be87224df88f80"
JWT_SECRET="your-secret-key-change-in-production"
ADMIN_PASSWORD_HASH="8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"
IMGUR_CLIENT_ID="YOUR_IMGUR_CLIENT_ID"

echo "📦 ${SERVICE_NAME} をデプロイ中..."

gcloud run deploy ${SERVICE_NAME} \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars JWT_SECRET=${JWT_SECRET},ADMIN_PASSWORD_HASH=${ADMIN_PASSWORD_HASH},LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN},LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET},IMGUR_CLIENT_ID=${IMGUR_CLIENT_ID}

ADMIN_URL=$(gcloud run services describe ${SERVICE_NAME} --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ ${SERVICE_NAME}: $ADMIN_URL"
echo "Webhook URL: ${ADMIN_URL}/webhook"
