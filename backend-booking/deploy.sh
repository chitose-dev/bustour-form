#!/bin/bash
# backend-booking デプロイスクリプト

set -e

PROJECT_ID="bustourreservation"
REGION="asia-northeast1"
SERVICE_NAME="backend-booking-v2"

# LINE_CHANNEL_TOKEN を直接設定（Cloud Run環境変数用）
LINE_CHANNEL_TOKEN="7VPCSNBWd0vNEfz2VjS8sUULmmn03iFSOkii4BPy4x6VtstE3Rzr2GsZAMy/PDkeiXIrau1DFqfrxtRuSc+5SkR6F682S6r/afFOEliyR7qN5ltkANsHihzjnIPJ7hzEuea1EcTdzR3cYeeScLgH/QdB04t89/1O/w1cDnyilFU="

echo "📦 ${SERVICE_NAME} をデプロイ中..."

gcloud run deploy ${SERVICE_NAME} \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN}

BOOKING_URL=$(gcloud run services describe ${SERVICE_NAME} --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ ${SERVICE_NAME}: $BOOKING_URL"
