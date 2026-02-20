#!/bin/bash

# デプロイスクリプト：backend-booking と backend-admin を Cloud Run にデプロイ

set -e

PROJECT_ID=${1:-your-gcp-project}
REGION=${2:-asia-northeast1}

echo "🚀 バスツアー予約管理システムをデプロイします"
echo "プロジェクト: $PROJECT_ID"
echo "リージョン: $REGION"

# ---------------------------------
# backend-booking のデプロイ
# ---------------------------------
echo ""
echo "📦 backend-booking をデプロイ中..."
cd backend-booking

gcloud run deploy backend-booking \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN}

BOOKING_URL=$(gcloud run services describe backend-booking --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ backend-booking: $BOOKING_URL"

cd ..

# ---------------------------------
# backend-admin のデプロイ
# ---------------------------------
echo ""
echo "📦 backend-admin をデプロイ中..."
cd backend-admin

gcloud run deploy backend-admin \
    --source . \
    --platform managed \
    --region $REGION \
    --project $PROJECT_ID \
    --allow-unauthenticated \
    --memory 512Mi \
    --timeout 540s \
    --set-env-vars JWT_SECRET=${JWT_SECRET},ADMIN_PASSWORD=${ADMIN_PASSWORD},LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN},IMGUR_CLIENT_ID=${IMGUR_CLIENT_ID}

ADMIN_URL=$(gcloud run services describe backend-admin --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ backend-admin: $ADMIN_URL"

cd ..

# ---------------------------------
# 出力
# ---------------------------------
echo ""
echo "=========================================="
echo "✅ デプロイ完了"
echo "=========================================="
echo ""
echo "Booking API: $BOOKING_URL"
echo "Admin API: $ADMIN_URL"
echo ""
echo "form.html の BOOKING_API_BASE を更新してください:"
echo "const BOOKING_API_BASE = \"$BOOKING_URL/api/booking\";"
echo ""
echo "admin.html の ADMIN_API_BASE を更新してください:"
echo "const ADMIN_API_BASE = \"$ADMIN_URL/api/admin\";"
echo ""

