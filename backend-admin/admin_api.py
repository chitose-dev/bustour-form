from flask import request, jsonify
from datetime import datetime
from auth import require_auth, generate_token, validate_password
from db import (
    get_reservations_with_filters, get_reservation, update_reservation_status, create_manual_reservation,
    get_tours, get_tour, create_tour, update_tour, delete_tour,
    get_pickups, create_pickup, update_pickup, delete_pickup,
    cleanup_old_cancelled_reservations
)
from pricing import calculate_total_price, aggregate_reservations
from line_api import send_cancellation_notification
import requests
import os

# 定数
IMGUR_CLIENT_ID = os.getenv('IMGUR_CLIENT_ID', 'YOUR_IMGUR_CLIENT_ID')

# ---------------------------------
# 認証
# ---------------------------------
def login():
    """
    POST /api/admin/login
    {password}
    """
    try:
        data = request.get_json()
        password = data.get('password')
        
        if not validate_password(password):
            return jsonify({'error': 'invalid_password'}), 401
        
        token = generate_token()
        return jsonify({'token': token}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def change_password():
    """
    POST /api/admin/change-password
    {currentPassword, newPassword}
    """
    try:
        data = request.get_json()
        current_password = data.get('currentPassword')
        new_password = data.get('newPassword')

        if not current_password or not new_password:
            return jsonify({'error': 'missing_fields'}), 400

        if not validate_password(current_password):
            return jsonify({'error': 'invalid_current_password'}), 401

        if len(new_password) < 4:
            return jsonify({'error': 'password_too_short'}), 400

        from auth import hash_password
        import subprocess
        new_hash = hash_password(new_password)

        # Cloud Run の環境変数を更新
        try:
            subprocess.run([
                'gcloud', 'run', 'services', 'update', 'backend-admin',
                '--region', 'asia-northeast1',
                '--update-env-vars', f'ADMIN_PASSWORD_HASH={new_hash}',
                '--quiet'
            ], check=True, timeout=60)
        except Exception as deploy_err:
            print(f"gcloud update failed: {deploy_err}")
            # gcloud が使えない場合はFirestoreにも保存しておく
            from db import db as firestore_db
            firestore_db.collection('settings').document('admin').set(
                {'password_hash': new_hash}, merge=True
            )

        # 現在のプロセスでも即座に反映
        import auth
        auth.ADMIN_PASSWORD_HASH = new_hash

        return jsonify({'message': 'password_changed'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------------------------------
# 予約管理
# ---------------------------------
@require_auth
def get_reservations_api():
    """
    GET /api/admin/reservations?tour_name=...&date_from=...&date_to=...&status=...
    """
    try:
        # キャンセルから3ヶ月経過した予約を自動で物理削除
        try:
            cleanup_old_cancelled_reservations(months=3)
        except Exception as cleanup_err:
            print(f"クリーンアップ警告（継続）: {cleanup_err}")

        tour_name = request.args.get('tour_name')
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        status = request.args.get('status', 'confirmed')  # デフォルトは confirmed
        
        reservations = get_reservations_with_filters(
            tour_name=tour_name,
            date_from=date_from,
            date_to=date_to,
            status=status
        )
        
        # 集計
        summary = aggregate_reservations(reservations)
        
        return jsonify({
            'reservations': reservations,
            'summary': summary
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def update_reservation_api(reservation_id):
    """
    PATCH /api/admin/reservations/{id}
    {status, progressStatus, remark}
    """
    try:
        data = request.get_json()
        new_status = data.get('status')
        progress_status = data.get('progressStatus')
        remark = data.get('remark')

        if new_status is None and progress_status is None and remark is None:
            return jsonify({'error': 'status or progressStatus or remark required'}), 400

        success = update_reservation_status(
            reservation_id,
            new_status=new_status,
            progress_status=progress_status,
            remark=remark
        )
        if not success:
            return jsonify({'error': 'reservation not found'}), 404
        
        # キャンセル時通知（オプション）
        if new_status == 'cancelled':
            res_data = get_reservation(reservation_id)
            if res_data and res_data.get('lineUserId'):
                send_cancellation_notification(
                    res_data.get('lineUserId'),
                    res_data.get('tourTitle'),
                    res_data.get('date')
                )
        
        return jsonify({'message': 'Reservation updated'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def create_reservation_api():
    """
    POST /api/admin/reservations
    {tour_id, date, tour_title, passengers, user_info, pickups, preferred_seats, total_price, remark}
    """
    try:
        data = request.get_json()
        
        tour_id = data.get('tour_id')
        date = data.get('date')
        tour_title = data.get('tour_title')
        passengers = data.get('passengers', 1)
        user_info = data.get('user_info', {})
        pickups = data.get('pickups', [])
        preferred_seats = data.get('preferred_seats', [])
        total_price = data.get('total_price', 0)
        remark = data.get('remark', '')
        
        # 入力値チェック
        if not all([tour_id, date, tour_title]):
            return jsonify({'error': 'tour_id, date, tour_title are required'}), 400
        
        # 定員チェック
        tour_doc = get_tour(tour_id)
        if not tour_doc:
            return jsonify({'error': 'tour not found'}), 404
        
        capacity = tour_doc.get('capacity', 0)
        reservations = get_reservations_with_filters(status='confirmed')
        current_count = sum(r.get('passengers', 0) for r in reservations if r.get('tour_id') == tour_id and r.get('date') == date)
        
        if current_count + passengers > capacity:
            return jsonify({'error': 'capacity exceeded'}), 400
        
        # 手入力予約作成（LINE通知なし）
        reservation_id = create_manual_reservation(
            tour_id, date, tour_title, passengers, user_info, pickups, preferred_seats, total_price, remark
        )
        
        return jsonify({'id': reservation_id, 'message': 'Reservation created'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------------------------------
# ツアー管理
# ---------------------------------
@require_auth
def get_tours_api():
    """
    GET /api/admin/tours?date_from=...&date_to=...
    """
    try:
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        
        tours = get_tours(date_from=date_from, date_to=date_to)
        return jsonify(tours), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def create_tour_api():
    """
    POST /api/admin/tours
    {title, date, deadline_date, capacity, price, status, description, image_url}
    """
    try:
        data = request.get_json()
        
        title = data.get('title')
        date = data.get('date')
        deadline_date = data.get('deadline_date')
        capacity = data.get('capacity')
        price = data.get('price')
        status = data.get('status', 'open')
        description = data.get('description', '')
        image_url = data.get('image_url', '')
        pickup_ids = data.get('pickupIds', [])
        
        if not all([title, date, deadline_date, capacity, price]):
            return jsonify({'error': 'required fields missing'}), 400
        
        tour_id = create_tour(title, date, deadline_date, capacity, price, status, description, image_url, pickup_ids)
        return jsonify({'id': tour_id, 'message': 'Tour created'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def update_tour_api(tour_id):
    """
    PATCH /api/admin/tours/{id}
    {title, date, deadline_date, capacity, price, status, description, image_url}
    """
    try:
        data = request.get_json()
        
        # 存在確認
        if not get_tour(tour_id):
            return jsonify({'error': 'tour not found'}), 404
        
        # 更新するフィールドのみ抽出
        update_fields = {}
        for field in ['title', 'date', 'deadline_date', 'capacity', 'price', 'status', 'description', 'image_url', 'pickupIds']:
            if field in data:
                update_fields[field] = data[field]
        
        if update_fields:
            update_tour(tour_id, **update_fields)
        
        return jsonify({'message': 'Tour updated'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def delete_tour_api(tour_id):
    """
    DELETE /api/admin/tours/{id}
    """
    try:
        if not get_tour(tour_id):
            return jsonify({'error': 'tour not found'}), 404
        
        delete_tour(tour_id)
        return jsonify({'message': 'Tour deleted'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------------------------------
# 乗車地管理
# ---------------------------------
@require_auth
def get_pickups_api():
    """
    GET /api/admin/pickups
    """
    try:
        pickups = get_pickups()
        return jsonify(pickups), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def create_pickup_api():
    """
    POST /api/admin/pickups
    {name, isActive, sortOrder}
    """
    try:
        data = request.get_json()
        name = data.get('name')
        is_active = data.get('isActive', True)
        sort_order = data.get('sortOrder', 0)
        
        if not name:
            return jsonify({'error': 'name required'}), 400
        
        pickup_id = create_pickup(name, is_active, sort_order)
        return jsonify({'id': pickup_id, 'message': 'Pickup created'}), 201
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def update_pickup_api(pickup_id):
    """
    PATCH /api/admin/pickups/{id}
    {name, isActive, sortOrder}
    """
    try:
        data = request.get_json()
        update_fields = {}
        
        for field in ['name', 'isActive', 'sortOrder']:
            if field in data:
                update_fields[field] = data[field]
        
        if update_fields:
            update_pickup(pickup_id, **update_fields)
        
        return jsonify({'message': 'Pickup updated'}), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@require_auth
def delete_pickup_api(pickup_id):
    """
    DELETE /api/admin/pickups/{id}
    """
    try:
        delete_pickup(pickup_id)
        return jsonify({'message': 'Pickup deleted'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ---------------------------------
# 画像アップロード
# ---------------------------------
@require_auth
def upload_image_api():
    """
    POST /api/admin/images/upload
    form-data: image (file)
    Imgur APIにアップロードしてURLを返す
    """
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'image file required'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'no file selected'}), 400
        
        # ファイルサイズチェック (最大10MB)
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > 10 * 1024 * 1024:
            return jsonify({'error': 'file too large (max 10MB)'}), 400
        
        # ファイル形式チェック
        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if file_ext not in allowed_extensions:
            return jsonify({'error': f'invalid file type. allowed: {", ".join(allowed_extensions)}'}), 400
        
        # Imgur API呼び出し
        import base64
        
        image_data = file.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')
        
        headers = {
            'Authorization': f'Client-ID {IMGUR_CLIENT_ID}'
        }
        payload = {
            'image': base64_image,
            'type': 'base64',
            'name': file.filename
        }
        
        response = requests.post(
            'https://api.imgur.com/3/image',
            headers=headers,
            data=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                image_url = result['data']['link']
                return jsonify({'url': image_url}), 200
            else:
                return jsonify({'error': 'imgur upload failed'}), 500
        else:
            error_msg = response.json().get('data', {}).get('error', 'unknown error')
            return jsonify({'error': f'imgur error: {error_msg}'}), response.status_code
    
    except requests.Timeout:
        return jsonify({'error': 'imgur request timeout'}), 504
    except requests.RequestException as e:
        return jsonify({'error': f'network error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
