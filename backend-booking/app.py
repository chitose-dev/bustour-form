import os
import json
from datetime import datetime
from datetime import timedelta
import smtplib
from email.message import EmailMessage
from flask import Flask, request, jsonify
from flask_cors import CORS
from google.cloud import firestore
from functools import wraps
import requests

app = Flask(__name__)
CORS(app)

# Firebase/Firestore初期化
db = firestore.Client()

# 定数
PREFERRED_SEAT_PRICE = 500
LINE_CHANNEL_TOKEN = os.getenv('LINE_CHANNEL_TOKEN', 'YOUR_LINE_CHANNEL_TOKEN')
LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push'
SMTP_HOST = os.getenv('SMTP_HOST', '')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_USER = os.getenv('SMTP_USER', '')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
SMTP_FROM = os.getenv('SMTP_FROM', SMTP_USER)
SMTP_USE_TLS = os.getenv('SMTP_USE_TLS', 'true').lower() == 'true'

# ---------------------------------
# ユーティリティ
# ---------------------------------
def get_today():
    """今日の日付を YYYY-MM-DD で返す"""
    return datetime.now().strftime('%Y-%m-%d')

def parse_date(date_str):
    """日付文字列をパース（YYYY-MM-DD）"""
    try:
        return datetime.strptime(date_str, '%Y-%m-%d')
    except:
        return None

def get_month_string(date_str):
    """YYYY-MM-DD から YYYY-MM を抽出"""
    return date_str[:7]

def get_tour_range_dates(start_date_str, end_date_str):
    """ツアー期間の開始日・終了日を返す（終了日が開始日より前なら開始日に揃える）"""
    start_date = parse_date(start_date_str)
    end_date = parse_date(end_date_str) if end_date_str else None

    if not start_date:
        return None, None

    if not end_date or end_date < start_date:
        end_date = start_date

    return start_date.date(), end_date.date()

# ---------------------------------
# LINE通知（スタブ）
# ---------------------------------
def send_line_notification(user_id, message):
    """LINE Messaging API で push通知を送信"""
    try:
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {LINE_CHANNEL_TOKEN}'
        }
        payload = {
            'to': user_id,
            'messages': [
                {
                    'type': 'text',
                    'text': message
                }
            ]
        }
        response = requests.post(LINE_MESSAGING_API, json=payload, headers=headers)
        return response.status_code == 200
    except Exception as e:
        print(f"LINE通知エラー: {e}")
        return False


def send_reservation_email(to_email, subject, body):
    """SMTPで予約完了メールを送信"""
    if not to_email:
        return False
    if not SMTP_HOST or not SMTP_FROM:
        print("メール送信スキップ: SMTP設定不足")
        return False

    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = SMTP_FROM
        msg['To'] = to_email
        msg.set_content(body)

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            if SMTP_USER and SMTP_PASSWORD:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception as e:
        print(f"メール送信エラー: {e}")
        return False

# ---------------------------------
# 予約API（backend-booking）
# ---------------------------------

@app.route('/api/booking/calendar', methods=['GET'])
def get_calendar():
    """
    月別のカレンダー可否取得
    ?month=YYYY-MM
    返却: {YYYY-MM-DD: {available: bool, reason: str}}
    """
    month = request.args.get('month') or datetime.now().strftime('%Y-%m')
    
    try:
        today = datetime.now().date()
        
        # ツアー一覧を取得（期間ツアー対応のため全件から判定）
        tours_ref = db.collection('tours')
        tours_docs = tours_ref.stream()
        
        # 日付ごとのツアー情報を集計
        tour_by_date = {}
        month_start = parse_date(f"{month}-01")
        if not month_start:
            return jsonify({'error': 'invalid month format'}), 400
        month_start = month_start.date()
        # 月末日を正しく算出（28/29/30/31日問題を回避）
        next_month = month_start.replace(day=28) + timedelta(days=4)
        month_end = (next_month - timedelta(days=next_month.day))

        for tour_doc in tours_docs:
            tour_data = tour_doc.to_dict()
            start_str = tour_data.get('date')
            end_str = tour_data.get('deadline_date')
            start_date, end_date = get_tour_range_dates(start_str, end_str)

            if not start_date or not end_date:
                continue

            # 対象月と重なるツアーだけ展開
            if end_date < month_start or start_date > month_end:
                continue

            cursor = max(start_date, month_start)
            cursor_end = min(end_date, month_end)
            while cursor <= cursor_end:
                date_key = cursor.strftime('%Y-%m-%d')
                if date_key not in tour_by_date:
                    tour_by_date[date_key] = []
                tour_by_date[date_key].append(tour_data)
                cursor += timedelta(days=1)
        
        # カレンダー用の結果を生成
        result = {}
        
        # 該当月の全日付を走査（簡略版：サンプル）
        for day in range(1, 32):
            date_str = f"{month}-{day:02d}"
            parsed = parse_date(date_str)
            if not parsed:
                break
            
            # グレーアウト判定
            available = True
            reason = ''
            
            if date_str not in tour_by_date:
                available = False
                reason = 'no_tour'
            else:
                if date_str < today.strftime('%Y-%m-%d'):
                    available = False
                    reason = 'deadline_passed'

                # ツアーが存在する場合、状態を確認
                has_open = False
                for tour in tour_by_date[date_str]:
                    deadline = tour.get('deadline_date')
                    status = tour.get('status', 'open')
                    
                    if deadline and deadline < today.strftime('%Y-%m-%d'):
                        continue  # 締切超過
                    if status != 'open':
                        continue  # openではない
                    
                    has_open = True
                    break
                
                if not has_open:
                    available = False
                    # 理由を詳細化
                    tour_sample = tour_by_date[date_str][0]
                    deadline = tour_sample.get('deadline_date')
                    status = tour_sample.get('status', 'open')
                    
                    if deadline and deadline < today.strftime('%Y-%m-%d'):
                        reason = 'deadline_passed'
                    elif status == 'full':
                        reason = 'full'
                    elif status == 'stop':
                        reason = 'stop'
                    elif status == 'hidden':
                        reason = 'hidden'
            
            result[date_str] = {
                'available': available,
                'reason': reason
            }
        
        return jsonify(result), 200
    
    except Exception as e:
        print(f"Calendar API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/booking/tours', methods=['GET'])
def get_tours():
    """
    日別のツアー一覧取得
    ?date=YYYY-MM-DD
    返却: [{id, title, price, status, image_url, description, capacity, current_count}]
    """
    date = request.args.get('date')
    if not date:
        return jsonify({'error': 'date parameter required'}), 400
    
    try:
        target_date = parse_date(date)
        if not target_date:
            return jsonify({'error': 'invalid date format'}), 400

        tours_ref = db.collection('tours')
        tours_docs = list(tours_ref.stream())
        
        result = []
        for tour_doc in tours_docs:
            tour_data = tour_doc.to_dict()
            tour_id = tour_doc.id

            status = tour_data.get('status')
            if status not in ['open', 'full']:
                continue

            start_date, end_date = get_tour_range_dates(tour_data.get('date'), tour_data.get('deadline_date'))
            if not start_date or not end_date:
                continue

            if not (start_date <= target_date.date() <= end_date):
                continue
            
            # 現在の予約数をカウント
            reservations_ref = db.collection('reservations').where('tour_id', '==', tour_id).where('status', '==', 'confirmed')
            current_count = sum(res.to_dict().get('passengers', 0) for res in reservations_ref.stream())
            
            result.append({
                'id': tour_id,
                'title': tour_data.get('title'),
                'price': tour_data.get('price'),
                'status': tour_data.get('status'),
                'image_url': tour_data.get('image_url'),
                'description': tour_data.get('description'),
                'capacity': tour_data.get('capacity'),
                'current_count': current_count
            })
        
        return jsonify(result), 200
    
    except Exception as e:
        print(f"Tours API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/booking/profile', methods=['GET'])
def get_profile():
    """
    顧客キャッシュ取得
    ?lineUserId=...
    返却: {name, phone, zip, pref, city, street, consentAutoFill}
    ※ consentAutoFill=true のときのみ自動入力候補として返す
    """
    line_user_id = request.args.get('lineUserId')
    if not line_user_id:
        return jsonify({}), 200  # 新規顧客
    
    try:
        user_profile_doc = db.collection('user_profiles').document(line_user_id).get()
        if user_profile_doc.exists:
            profile_data = user_profile_doc.to_dict()
            # consentAutoFill=true のときのみ自動入力候補として返す
            if profile_data.get('consentAutoFill', False):
                return jsonify(profile_data), 200
            else:
                return jsonify({}), 200  # 同意していない場合は空を返す
        else:
            return jsonify({}), 200
    
    except Exception as e:
        print(f"Profile API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/booking/pickups', methods=['GET'])
def get_pickups():
    """
    乗車地一覧取得（アクティブなもののみ）
    返却: [{id, name, sortOrder}]
    """
    try:
        pickups_ref = db.collection('pickups')
        pickups = []
        for doc in pickups_ref.stream():
            pickup_data = doc.to_dict()
            if not pickup_data.get('isActive', True):
                continue
            pickups.append({
                'id': doc.id,
                'name': pickup_data.get('name'),
                'sortOrder': pickup_data.get('sortOrder', 0)
            })
        pickups.sort(key=lambda item: item.get('sortOrder', 0))
        return jsonify(pickups), 200
    
    except Exception as e:
        print(f"Pickups API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/booking/price_preview', methods=['POST'])
def price_preview():
    """
    料金プレビュー（オプション）
    POST {passengers, pricePerPerson, preferredSeats}
    返却: {baseTour, seatPrice, total}
    """
    try:
        data = request.get_json()
        passengers = data.get('passengers', 0)
        price_per_person = data.get('pricePerPerson', 0)
        preferred_seats = data.get('preferredSeats', [])
        
        base_tour = passengers * price_per_person
        seat_price = len([s for s in preferred_seats if s]) * PREFERRED_SEAT_PRICE
        total = base_tour + seat_price
        
        return jsonify({
            'baseTour': base_tour,
            'seatPrice': seat_price,
            'total': total
        }), 200
    
    except Exception as e:
        print(f"Price preview error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/booking/reservations', methods=['POST'])
def create_reservation():
    """
    予約作成（トランザクション対応）
    POST {lineUserId, date, tourId, tourTitle, pricePerPerson, userInfo, passengers, pickups, preferredSeats, consentAutoFill}
    """
    try:
        data = request.get_json()
        line_user_id = (data.get('lineUserId') or '').strip()
        liff_access_token = (data.get('liffAccessToken') or '').strip()
        date = data.get('date')
        tour_id = data.get('tourId')
        tour_title = data.get('tourTitle')
        price_per_person = data.get('pricePerPerson')
        user_info = data.get('userInfo', {})
        passengers = data.get('passengers', 1)
        pickups = data.get('pickups', [])
        preferred_seats = data.get('preferredSeats', [])
        consent_auto_fill = data.get('consentAutoFill', False)

        if not all([date, tour_id, tour_title]):
            return jsonify({'error': 'required fields missing'}), 400

        # lineUserIdが無い場合、LIFFアクセストークンからLINE APIで取得
        if not line_user_id and liff_access_token:
            try:
                resp = requests.get(
                    'https://api.line.me/v2/profile',
                    headers={'Authorization': f'Bearer {liff_access_token}'},
                    timeout=5
                )
                if resp.status_code == 200:
                    profile_data = resp.json()
                    line_user_id = profile_data.get('userId', '')
                    print(f'Resolved lineUserId from access token: {line_user_id}')
                else:
                    print(f'LINE profile API failed: {resp.status_code} {resp.text}')
            except Exception as token_err:
                print(f'Failed to resolve lineUserId from token: {token_err}')

        if not line_user_id:
            return jsonify({'error': 'lineUserId is required. Please open from LINE app.'}), 400

        try:
            passengers = int(passengers)
            price_per_person = int(price_per_person)
        except (TypeError, ValueError):
            return jsonify({'error': 'invalid numeric fields'}), 400

        if passengers <= 0 or price_per_person < 0:
            return jsonify({'error': 'invalid passengers or pricePerPerson'}), 400
        
        # トランザクション開始
        @firestore.transactional
        def transfer(transaction):
            # 1. ツアード情報取得
            tour_ref = db.collection('tours').document(tour_id)
            tour_doc = tour_ref.get(transaction=transaction)
            if not tour_doc.exists:
                raise ValueError('Tour not found')
            
            tour_data = tour_doc.to_dict()
            capacity = tour_data.get('capacity', 0)
            deadline_date = tour_data.get('deadline_date')
            status = tour_data.get('status', 'open')
            
            # 2. 締切チェック
            today = get_today()
            if deadline_date and deadline_date < today:
                raise ValueError('Booking deadline passed')
            
            # 3. ステータスチェック（openのみ受付）
            if status != 'open':
                raise ValueError(f'Tour status is {status}, cannot book')
            
            # 4. 重複予約チェック（lineUserId がある場合のみ）
            all_reservation_docs = list(db.collection('reservations').stream())
            for doc in all_reservation_docs:
                reservation_data = doc.to_dict()
                existing_line_user_id = reservation_data.get('lineUserId') or reservation_data.get('line_user_id')
                if (
                    reservation_data.get('status') == 'confirmed'
                    and reservation_data.get('tour_id') == tour_id
                    and reservation_data.get('date') == date
                    and existing_line_user_id == line_user_id
                ):
                    raise ValueError('Duplicate reservation')
            
            # 5. 現在の予約人数をカウント
            current_count = 0
            for res_doc in db.collection('reservations').stream():
                reservation_data = res_doc.to_dict()
                if reservation_data.get('tour_id') == tour_id and reservation_data.get('status') == 'confirmed':
                    current_count += int(reservation_data.get('passengers', 0) or 0)
            
            # 6. 定員チェック
            if current_count + passengers > capacity:
                raise ValueError('Capacity exceeded')
            
            # 7. 予約作成
            seat_upcharge = len([s for s in preferred_seats if s]) * PREFERRED_SEAT_PRICE
            total_price = passengers * price_per_person + seat_upcharge
            
            reservation = {
                'lineUserId': line_user_id,
                'line_user_id': line_user_id,
                'tour_id': tour_id,
                'date': date,
                'tourTitle': tour_title,
                'passengers': passengers,
                'userInfo': user_info,
                'pickups': pickups,
                'preferredSeats': preferred_seats,
                'totalPrice': total_price,
                'status': 'confirmed',
                'progressStatus': 'shipping',
                'remark': str((user_info or {}).get('remark') or '').strip(),
                'createdAt': datetime.now().isoformat(),
                'isManualEntry': False
            }
            
            res_ref = db.collection('reservations').document()
            transaction.set(res_ref, reservation)
            reservation_id = res_ref.id
            
            # 8. 満席チェック＆ステータス更新
            new_count = current_count + passengers
            if new_count >= capacity:
                transaction.update(tour_ref, {'status': 'full', 'updatedAt': datetime.now().isoformat()})
            
            # 9. 顧客情報 upsert（lineUserId がある場合のみ）
            if line_user_id:
                user_profile = {
                    'name': user_info.get('name'),
                    'phone': user_info.get('phone'),
                    'email': user_info.get('email'),
                    'zip': user_info.get('zip'),
                    'pref': user_info.get('pref'),
                    'city': user_info.get('city'),
                    'street': user_info.get('street'),
                    'consentAutoFill': consent_auto_fill,
                    'updatedAt': datetime.now().isoformat()
                }
                user_profile_ref = db.collection('user_profiles').document(line_user_id)
                transaction.set(user_profile_ref, user_profile, merge=True)
            
            return reservation_id, total_price
        
        # トランザクション実行
        transaction = db.transaction()
        reservation_id, calculated_total_price = transfer(transaction)
        
        # 10. LINE通知（lineUserId がある通常予約のみ）
        # 乗車地表示を組み立て
        pickup_display = ''
        if pickups:
            if len(pickups) == 1:
                pickup_display = pickups[0] if isinstance(pickups[0], str) else pickups[0].get('name', '')
            else:
                pickup_lines = []
                for i, p in enumerate(pickups):
                    loc_name = p if isinstance(p, str) else p.get('name', '')
                    prefix = '代表者' if i == 0 else f'{i+1}人目'
                    pickup_lines.append(f"{prefix}: {loc_name}")
                pickup_display = "\n".join(pickup_lines)
        
        representative_name = (user_info or {}).get('name', '')

        message = f"""下記の通りお申込を承りました。

📅 日付: {date}
🚌 コース名: {tour_title}
👤 代表者: {representative_name}様
👥 人数: {passengers}名
💰 料金: ¥{calculated_total_price:,}
🚏 乗車地: 
{pickup_display}

📝 お申込み状況: 申込受付中

お問い合わせありがとうございます。
正式なご予約は、弊社からのご連絡をもって確定となります。
担当者からのご連絡をお待ちください。

2営業日（土日祝定休）を経過しても連絡がない場合は、お申込が届いていない可能性がございます。
その際はお手数ですがご一報ください。

乗車地【木之本・米原・彦根】は、他のお客様を含めて5名以上の申込みがない場合、乗車地の変更をお願いする場合がございます。

【よくある質問】
・時間は何時ですか？←旅行日より１～２週間前に旅程表をお送りいたしますのでお待ち下さい
・お支払いはどうしたら良いですか？←当日現金またはPayPayで頂戴しております"""

        if line_user_id:
            send_line_notification(line_user_id, message)

        user_email = str((user_info or {}).get('email') or '').strip()
        if user_email:
            email_subject = f"【予約完了】{tour_title} ({date})"
            email_body = f"""ご予約ありがとうございます。

以下の内容で予約を受け付けました。

予約ID: {reservation_id}
ツアー名: {tour_title}
日付: {date}
人数: {passengers}名
金額: ¥{calculated_total_price:,}

キャンセルの際は公式LINEからご連絡ください。"""
            send_reservation_email(user_email, email_subject, email_body)
        
        return jsonify({'id': reservation_id, 'message': 'Reservation confirmed'}), 200
    
    except ValueError as e:
        if 'Duplicate' in str(e):
            return jsonify({'error': str(e)}), 409
        elif 'Capacity' in str(e):
            return jsonify({'error': str(e)}), 400
        elif 'deadline' in str(e):
            return jsonify({'error': str(e)}), 400
        else:
            return jsonify({'error': str(e)}), 400
    
    except Exception as e:
        print(f"Reservation API error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    """ヘルスチェック"""
    return jsonify({'status': 'ok'}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)
