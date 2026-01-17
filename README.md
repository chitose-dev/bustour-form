# 予約管理システム 要件定義書準拠実装

LINE起点のバスツアー予約管理システム。高齢者でも使いやすいUIと、管理業務の自動化を実現します。

## システム構成（デュアルバックエンド版）

```
予約管理システム/
├── フロントエンド (GitHub Pages)
│  ├── form.html              (お客様向け予約フォーム B-01～B-06)
│  ├── admin.html             (管理者向け管理画面 A-01～A-06)
│  ├── script.js              (管理画面ロジック)
│  └── style.css              (共通スタイル)
│
├── バックエンド (Cloud Run - 2サービス)
│  ├── backend-booking/       (予約API - LIFF前提)
│  │  ├── app.py              (5つのエンドポイント)
│  │  ├── requirements.txt
│  │  ├── Dockerfile
│  │  └── firebase-key.json   (環境ごとに配置)
│  │
│  └── backend-admin/         (管理API - 認証必須)
│     ├── app.py              (ルーティング)
│     ├── auth.py             (JWT認証)
│     ├── db.py               (Firestore操作)
│     ├── admin_api.py        (8つのAPIハンドラ)
│     ├── pricing.py          (料金計算)
│     ├── line_api.py         (LINE通知)
│     ├── utils.py            (ユーティリティ)
│     ├── requirements.txt
│     ├── Dockerfile
│     └── firebase-key.json   (環境ごとに配置)
│
├── DB (Firestore - 共通)
│  ├── tours                  (ツアー情報)
│  ├── reservations           (予約情報)
│  ├── pickups                (乗車地情報)
│  └── user_profiles          (顧客情報キャッシュ)
│
├── 通知 (LINE Messaging API)
└── 画像管理 (Imgur API)
```

## 画面フロー

### お客様向け予約フォーム（B-01～B-06）

| 画面ID | 目的 | 主な機能 |
|--------|------|---------|
| B-01 | カレンダー表示 | 月表示、ツアー無し/締切超過/full/stop は自動グレーアウト |
| B-02 | ツアー一覧表示 | 同日複数ツアー対応、カード形式で表示 |
| B-03 | 予約者情報入力 | LIFF自動ログイン、前回情報の自動入力（ダイアログ）、前列座席指定 |
| B-04 | 乗車地点選択 | 人数1人時：1つ選択、2人以上：「全員同じ」「一人ずつ」の分岐 |
| B-05 | 予約内容確認 | 基本料金+座席指定料を表示、二重送信対策（ボタングレーアウト） |
| B-06 | 予約受付完了 | 固定文言表示、LINEに戻す案内 |

### 管理画面（A-01～A-06）

| 画面ID | 目的 | 主な機能 |
|--------|------|---------|
| A-01 | ログイン | パスワード入力 → JWT トークン生成 |
| A-02 | 予約台帳一覧 | フィルタ（ツアー名/日付/ステータス）、集計（人数合計/売上合計） |
| A-03 | 予約詳細 | ステータス変更（キャンセル含む）、在庫復元処理 |
| A-04 | 手入力予約 | 電話/メール予約の代理入力（LINE通知なし） |
| A-05 | ツアー管理 | 作成・編集・削除、ステータス(open/full/stop/hidden)切替 |
| A-06 | 乗車地管理 | 追加・編集・無効化、並び順変更 |

## 重要な実装機能

### ✅ 在庫・予約制限

| 機能 | 実装方式 | 備考 |
|------|---------|------|
| **定員管理** | Firestore トランザクション | 予約時に定員チェック、超過時は即エラー |
| **満席の自動処理** | トランザクション内で ツアー.status → full | カレンダー・一覧にも即反映 |
| **予約締切** | 日付比較→グレーアウト + API側でも不可 | 手入力予約は関係なく追加可能 |
| **重複予約防止** | 同日・同ツアー・同lineUserId で一意制約 | APIレベルで409返却 |
| **二重送信対策** | フロント：ボタングレーアウト + 読み込み中…表示 | バック：重複チェック |

### ✅ 顧客情報の自動入力

1. **LIFF ログイン時** → lineUserId 取得
2. **user_profiles/{lineUserId} を検索**
3. **データ存在時** → 「前回の情報を自動入力」ボタン表示
   - ダイアログで保存済み情報を確認
   - 「この情報を入力」で入力欄に反映
4. **予約完了時** → user_profiles upsert
   - 「次回も OK」= true の場合のみ consentAutoFill=true で保存

### ✅ キャンセル対応

- **ユーザー側**：Web上でのキャンセル操作は不可、公式LINEからのみ
- **管理者側**：管理画面でステータス変更
- **在庫復元**：キャンセル確定時に予約人数をマイナス、定員未満になったら full→open に復元

## API仕様

### backend-booking （予約API）- 認証不要

| 画面 | Method | Path | 説明 | 戻値 |
|------|--------|------|------|------|
| B-01,B-02 | GET | `/api/booking/calendar?month=YYYY-MM` | 月別のカレンダー可否 | `{YYYY-MM-DD: {available, reason}}` |
| B-02 | GET | `/api/booking/tours?date=YYYY-MM-DD` | ツアー一覧取得 | `[{id, title, price, status, ...}]` |
| B-03 | GET | `/api/booking/profile?lineUserId=...` | 顧客キャッシュ取得 | `{name, phone, zip, pref, city, street, consentAutoFill}` |
| B-05 | POST | `/api/booking/price_preview` | 料金プレビュー（オプション） | `{baseTour, seatPrice, total}` |
| B-06 | POST | `/api/booking/reservations` | **予約作成（トランザクション）** | `{id, message}` / 409/400エラー |

**POST /api/booking/reservations 内部処理:**
- 重複予約判定（同日・同ツアー・同lineUserId）
- Firestore Transaction：定員チェック→予約人数加算→予約保存→満席到達なら tours.status=full
- deadline 超過・status≠open なら弾く
- user_profiles upsert（「次回も OK」=true のとき consentAutoFill=true）
- LINE通知：通常予約のみ（お客様+管理者）

### backend-admin （管理API）- 認証必須（JWT Bearer Token）

| 画面 | Method | Path | 説明 | 備考 |
|------|--------|------|------|------|
| A-01 | POST | `/api/admin/login` | ログイン | password → JWT token |
| A-02 | GET | `/api/admin/reservations?tour_name=...&date_from=...&date_to=...&status=...` | 予約台帳一覧 | 集計{peopleTotal, salesTotal}含める |
| A-03 | PATCH | `/api/admin/reservations/{id}` | ステータス変更 | キャンセル時：在庫復元処理 |
| A-04 | POST | `/api/admin/reservations` | 手入力予約追加 | lineUserId=null, isManualEntry=true, LINE通知なし |
| A-05 | GET | `/api/admin/tours` | ツアー一覧 | date_from/date_to で絞込可 |
| A-05 | POST | `/api/admin/tours` | ツアー作成 | capacity/deadline_date/status/画像URL等 |
| A-05 | PATCH | `/api/admin/tours/{id}` | ツアー更新 | full/stop/hidden 切替も含む |
| A-05 | DELETE | `/api/admin/tours/{id}` | ツアー削除 | - |
| A-06 | GET | `/api/admin/pickups` | 乗車地一覧 | - |
| A-06 | POST | `/api/admin/pickups` | 乗車地追加 | - |
| A-06 | PATCH | `/api/admin/pickups/{id}` | 乗車地更新 | isActive, sortOrder 等更新可 |
| - | POST | `/api/admin/images/upload` | 画像アップロード | Imgur API経由 |

## DB スキーマ（Firestore）

### tours
\`\`\`javascript
{
  id: string,
  title: string,
  date: string (YYYY-MM-DD),
  deadline_date: string (YYYY-MM-DD),
  capacity: number,
  price: number,
  status: string (open|full|stop|hidden),
  description: string,
  image_url: string,
  createdAt: string (ISO),
  updatedAt: string (ISO)
}
\`\`\`

### reservations
\`\`\`javascript
{
  id: string,
  lineUserId: string (手入力の場合はnull),
  tour_id: string,
  date: string (YYYY-MM-DD),
  tourTitle: string,
  passengers: number,
  userInfo: {
    name: string,
    phone: string,
    zip: string,
    pref: string,
    city: string,
    street: string
  },
  pickups: [string],
  preferredSeats: [boolean],
  totalPrice: number,
  status: string (confirmed|cancelled),
  createdAt: string (ISO),
  cancelledAt: string (ISO, optional),
  isManualEntry: boolean (optional)
}
\`\`\`

### user_profiles
\`\`\`javascript
{
  id: string (lineUserId),
  name: string,
  phone: string,
  zip: string,
  pref: string,
  city: string,
  street: string,
  consentAutoFill: boolean,
  updatedAt: string (ISO)
}
\`\`\`

### pickups
\`\`\`javascript
{
  id: string,
  name: string,
  isActive: boolean,
  sortOrder: number,
  createdAt: string (ISO),
  updatedAt: string (ISO)
}
\`\`\`

## セットアップ

### 1. 環境変数設定

\`\`\`bash
# プロジェクトルートに .env を作成
cat > .env << 'EOF'
GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-key.json
JWT_SECRET=your-secret-key-change-in-production
ADMIN_PASSWORD=admin
LINE_CHANNEL_TOKEN=your-line-channel-token
IMGUR_CLIENT_ID=your-imgur-client-id
EOF
\`\`\`

### 2. Firebase設定

\`\`\`bash
# Firebase認証キーをダウンロード（GCP コンソール）
# backend-booking/firebase-key.json
# backend-admin/firebase-key.json
# （同じキーを両方に配置）
\`\`\`

### 3. ローカル実行

#### backend-booking

\`\`\`bash
cd backend-booking
pip install -r requirements.txt
python app.py
# http://localhost:8080 でアクセス可能
\`\`\`

#### backend-admin

\`\`\`bash
cd backend-admin
pip install -r requirements.txt
python app.py
# http://localhost:8080 でアクセス可能（別ターミナル）
\`\`\`

### 4. Cloud Runへデプロイ

\`\`\`bash
# 環境変数を設定
export LINE_CHANNEL_TOKEN=...
export JWT_SECRET=...
export ADMIN_PASSWORD=...
export IMGUR_CLIENT_ID=...

# デプロイスクリプト実行
chmod +x deploy.sh
./deploy.sh your-gcp-project asia-northeast1
\`\`\`

## 実装完了チェックリスト

- [x] LIFF統合（自動ログイン）
- [x] カレンダー表示（グレーアウト対応）
- [x] 前列座席指定（+500円/人・個別選択）
- [x] 乗車地点選択（全員同じ/一人ずつ）
- [x] 顧客情報の自動入力（「次回も OK」連動）
- [x] 二重送信対策
- [x] 重複予約防止（同日・同ツアー・同lineUserId）
- [x] 定員管理＆満席自動処理
- [x] 締切日管理
- [x] 在庫復元（キャンセル時）
- [x] 管理画面 - 予約台帳一覧（フィルタ+集計）
- [x] 管理画面 - 手入力予約（LINE通知なし）
- [x] 管理画面 - ツアー管理
- [x] 管理画面 - 乗車地管理
- [ ] LINE Messaging API統合（予約・キャンセル通知）
- [ ] Imgur API画像アップロード実装

## 注意事項

- **認証情報**：\`.env\` で管理（Git コミット対象外）
- **Firestore 料金**：読み書き料金に注意
- **LINE通知**：送信限度あり（制限超過時は一時的に配信停止）
- **本番環境**：LIFF ID、認証情報、JWT_SECRETを適切に設定
- **バックエンド**：2つの独立したCloud Runサービスとして動作
  - backend-booking：LIFF ユーザー向け（認証不要）
  - backend-admin：管理者向け（JWT Bearer Token必須）

## トラブルシューティング

### 予約が409（重複）で弾かれる
→ 同一日付・同ツアー・同lineUserId の予約がすでに存在。ステータスをconfirmedで確認。

### 満席なのにステータスが open のまま
→ Firestore トランザクションが失敗している可能性。ログで確認。

### LINE通知が送信されない
→ LINE_CHANNEL_TOKEN が正しく設定されているか確認。Messaging API の有効化を確認。

### 管理画面にログインできない
→ ADMIN_PASSWORD が \`.env\` と admin.html で一致しているか確認。JWT_SECRET も確認。
