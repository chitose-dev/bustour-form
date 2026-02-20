import os
import json
from datetime import datetime
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
    month = request.args.get('month')
    if not month:
        return jsonify({'error': 'month parameter required'}), 400
    
    try:
        today = datetime.now().date()
        
        # その月のツアー一覧を取得
        tours_ref = db.collection('tours').where('date', '>=', f"{month}-01").where('date', '<', f"{month}-32")
        tours_docs = tours_ref.stream()
        
        # 日付ごとのツアー情報を集計
        tour_by_date = {}
        for tour_doc in tours_docs:
            tour_data = tour_doc.to_dict()
            date = tour_data.get('date')
            if date:
                if date not in tour_by_date:
                    tour_by_date[date] = []
                tour_by_date[date].append(tour_data)
        
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
        tours_ref = db.collection('tours').where('date', '==', date).where('status', 'in', ['open', 'full'])
        tours_docs = list(tours_ref.stream())
        
        result = []
        for tour_doc in tours_docs:
            tour_data = tour_doc.to_dict()
            tour_id = tour_doc.id
            
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
        pickups_ref = db.collection('pickups').where('isActive', '==', True).order_by('sortOrder')
        pickups = []
        for doc in pickups_ref.stream():
            pickup_data = doc.to_dict()
            pickups.append({
                'id': doc.id,
                'name': pickup_data.get('name'),
                'sortOrder': pickup_data.get('sortOrder', 0)
            })
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
        line_user_id = data.get('lineUserId')
        date = data.get('date')
        tour_id = data.get('tourId')
        tour_title = data.get('tourTitle')
        price_per_person = data.get('pricePerPerson')
        user_info = data.get('userInfo', {})
        passengers = data.get('passengers', 1)
        pickups = data.get('pickups', [])
        preferred_seats = data.get('preferredSeats', [])
        consent_auto_fill = data.get('consentAutoFill', False)
        
        # トランザクション開始
        @firestore.transactional
        def transfer(transaction):
            # 1. ツアード情報取得
            tour_ref = db.collection('tours').document(tour_id)
            tour_doc = transaction.get(tour_ref)
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
            
            # 4. 重複予約チェック
            existing_ref = db.collection('reservations').where('line_user_id', '==', line_user_id).where('tour_id', '==', tour_id).where('date', '==', date).where('status', '==', 'confirmed')
            existing = list(transaction.get(existing_ref) if hasattr(transaction, 'get') else [])
            
            # 代替手段：単純クエリ（transactionで直接クエリはできないため）
            existing_docs = list(db.collection('reservations').where('lineUserId', '==', line_user_id).where('tour_id', '==', tour_id).where('date', '==', date).where('status', '==', 'confirmed').stream())
            
            if existing_docs:
                raise ValueError('Duplicate reservation')
            
            # 5. 現在の予約人数をカウント
            current_count_docs = db.collection('reservations').where('tour_id', '==', tour_id).where('status', '==', 'confirmed').stream()
            current_count = sum(res.to_dict().get('passengers', 0) for res in current_count_docs)
            
            # 6. 定員チェック
            if current_count + passengers > capacity:
                raise ValueError('Capacity exceeded')
            
            # 7. 予約作成
            seat_upcharge = len([s for s in preferred_seats if s]) * PREFERRED_SEAT_PRICE
            total_price = passengers * price_per_person + seat_upcharge
            
            reservation = {
                'lineUserId': line_user_id,
                'tour_id': tour_id,
                'date': date,
                'tourTitle': tour_title,
                'passengers': passengers,
                'userInfo': user_info,
                'pickups': pickups,
                'preferredSeats': preferred_seats,
                'totalPrice': total_price,
                'status': 'confirmed',
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
            
            # 9. 顧客情報 upsert
            user_profile = {
                'name': user_info.get('name'),
                'phone': user_info.get('phone'),
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
        
        # 10. LINE通知（通常予約のみ）
        message = f"""予約を受け付けました

ツアー名：{tour_title}
日付：{date}
人数：{passengers}名
金額：¥{calculated_total_price:,}

キャンセルの際は公式LINEからご連絡ください"""
        
        send_line_notification(line_user_id, message)
        
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
