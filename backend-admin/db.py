from google.cloud import firestore
from datetime import datetime, timedelta

db = firestore.Client()
SPECIAL_MEMBER_DISCOUNT_PER_PERSON = 300

# ---------------------------------
# 予約操作
# ---------------------------------
def get_reservations_with_filters(tour_name=None, date_from=None, date_to=None, status=None):
    """フィルタ付き予約一覧取得"""
    query = db.collection('reservations')
    
    if status:
        query = query.where('status', '==', status)
    
    reservations = []
    for doc in query.stream():
        res_data = doc.to_dict()
        
        # 日付フィルタ
        if date_from and res_data.get('date', '') < date_from:
            continue
        if date_to and res_data.get('date', '') > date_to:
            continue
        
        # ツアー名フィルタ
        if tour_name and tour_name not in res_data.get('tourTitle', ''):
            continue
        
        res_data['id'] = doc.id
        reservations.append(res_data)
    
    return reservations

def get_reservation(reservation_id):
    """予約詳細取得"""
    doc = db.collection('reservations').document(reservation_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data['id'] = doc.id
    return data

def update_reservation_status(reservation_id, new_status=None, progress_status=None, remark=None):
    """予約更新（status / progressStatus / remark）- キャンセル時は在庫を確実に復元"""
    res_doc = db.collection('reservations').document(reservation_id).get()
    if not res_doc.exists:
        return False
    
    res_data = res_doc.to_dict()
    tour_id = res_data.get('tour_id')
    passengers = res_data.get('passengers', 0)
    
    # トランザクション開始
    @firestore.transactional
    def update_with_inventory(transaction):
        # === 全ての読み取りを先に行う ===
        res_ref = db.collection('reservations').document(reservation_id)
        res_snapshot = res_ref.get(transaction=transaction)
        if not res_snapshot.exists:
            raise ValueError('Reservation not found in transaction')

        tour_ref = None
        tour_data = None
        current_count = 0

        if new_status == 'cancelled' and tour_id:
            tour_ref = db.collection('tours').document(tour_id)
            tour_snapshot = tour_ref.get(transaction=transaction)
            if tour_snapshot.exists:
                tour_data = tour_snapshot.to_dict()
                # 現在の確定済み予約人数を再計算（キャンセル対象を除外）
                all_reservations = list(db.collection('reservations').where('tour_id', '==', tour_id).stream())
                for res in all_reservations:
                    r_data = res.to_dict()
                    if res.id != reservation_id and r_data.get('status') in ('confirmed', 'pending'):
                        current_count += int(r_data.get('passengers', 0) or 0)

        # === 全ての書き込みをまとめて行う ===
        update_payload = {'updatedAt': datetime.now().isoformat()}
        if new_status is not None:
            update_payload['status'] = new_status
            update_payload['cancelledAt'] = datetime.now().isoformat() if new_status == 'cancelled' else None
        if progress_status is not None:
            update_payload['progressStatus'] = progress_status
        if remark is not None:
            update_payload['remark'] = remark

        transaction.update(res_ref, update_payload)
        
        # キャンセル時の在庫復元
        if new_status == 'cancelled' and tour_id and tour_data:
            capacity = tour_data.get('capacity', 0)
            current_tour_status = tour_data.get('status')
            
            print(f"キャンセル在庫復元: tour={tour_id}, 定員={capacity}, 現在確定人数={current_count}, ツアー状態={current_tour_status}")
            
            if current_tour_status == 'full' and current_count < capacity:
                transaction.update(tour_ref, {
                    'status': 'open',
                    'updatedAt': datetime.now().isoformat()
                })
                print(f"ツアー状態を full → open に復元: tour={tour_id}")
    
    transaction = db.transaction()
    update_with_inventory(transaction)
    return True


def _apply_member_discount_to_reservation_doc(doc_ref, data, enabled):
    """予約ドキュメント1件に会員割引を適用/解除する"""
    passengers = int(data.get('passengers', 0) or 0)
    current_total = int(data.get('totalPrice', 0) or 0)
    prev_discount = int(data.get('memberDiscountTotal', 0) or 0)

    # 既存金額に前回割引を戻して基準金額を復元
    base_total = current_total + prev_discount
    next_discount = passengers * SPECIAL_MEMBER_DISCOUNT_PER_PERSON if enabled else 0
    next_total = max(base_total - next_discount, 0)

    doc_ref.update({
        'specialMember': enabled,
        'memberDiscountPerPerson': SPECIAL_MEMBER_DISCOUNT_PER_PERSON if enabled else 0,
        'memberDiscountTotal': next_discount,
        'totalPrice': next_total,
        'updatedAt': datetime.now().isoformat()
    })


def set_special_member_for_reservation(reservation_id, enabled):
    """予約詳細チェックで特別会員をON/OFFし、該当予約のみ割引反映。
    次回以降は LINE user id の会員状態のみ参照する。"""
    target_ref = db.collection('reservations').document(reservation_id)
    target_doc = target_ref.get()
    if not target_doc.exists:
        return False, 'reservation_not_found', 0

    target_data = target_doc.to_dict()
    if target_data.get('status') == 'cancelled':
        return False, 'reservation_cancelled', 0

    line_user_id = target_data.get('lineUserId') or target_data.get('line_user_id')
    if not line_user_id:
        return False, 'line_user_id_required', 0

    # LINE user id リストを管理（最後に編集された状態を保持）
    member_ref = db.collection('special_member_line_users').document(line_user_id)
    member_ref.set({
        'lineUserId': line_user_id,
        'enabled': bool(enabled),
        'discountPerPerson': SPECIAL_MEMBER_DISCOUNT_PER_PERSON,
        'updatedAt': datetime.now().isoformat()
    }, merge=True)

    # 今回編集した予約1件のみに反映（既存の他予約には適用しない）
    _apply_member_discount_to_reservation_doc(target_ref, target_data, bool(enabled))

    return True, '', 1

def create_manual_reservation(tour_id, date, tour_title, passengers, user_info, pickups, preferred_seats, total_price, remark=''):
    """手入力予約作成（LINE通知なし）"""
    reservation = {
        'lineUserId': None,
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
        'remark': remark,
        'isManualEntry': True,
        'createdAt': datetime.now().isoformat()
    }
    
    doc_ref = db.collection('reservations').document()
    doc_ref.set(reservation)
    
    return doc_ref.id

def get_user_active_reservations(line_user_id):
    """ユーザーの有効な予約を取得（開催日が過ぎた予約を除外）"""
    today = datetime.now().strftime('%Y-%m-%d')
    reservations = []

    query = db.collection('reservations') \
        .where('lineUserId', '==', line_user_id)

    for doc in query.stream():
        res_data = doc.to_dict()
        # 当日以降の予約のみ（当日含む）
        if res_data.get('date', '') >= today:
            res_data['id'] = doc.id
            reservations.append(res_data)

    # 日付順でソート
    reservations.sort(key=lambda x: x.get('date', ''))
    return reservations

# ---------------------------------
# ツアー操作
# ---------------------------------
def get_tours(date_from=None, date_to=None):
    """ツアー一覧取得（日付範囲指定可）"""
    query = db.collection('tours')
    tours = []
    
    for doc in query.stream():
        tour_data = doc.to_dict()
        date = tour_data.get('date', '')
        
        # 日付フィルタ
        if date_from and date < date_from:
            continue
        if date_to and date > date_to:
            continue
        
        # 現在の予約数をカウント（申込中・確定済みを合算）
        reservations_ref = db.collection('reservations').where('tour_id', '==', doc.id)
        current_count = sum(
            res.to_dict().get('passengers', 0)
            for res in reservations_ref.stream()
            if res.to_dict().get('status') in ('confirmed', 'pending')
        )
        
        tour_data['id'] = doc.id
        tour_data['current_count'] = current_count
        tours.append(tour_data)
    
    return tours

def get_tour(tour_id):
    """ツアー詳細取得"""
    doc = db.collection('tours').document(tour_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    data['id'] = doc.id
    return data

def create_tour(title, date, deadline_date, capacity, price, status='open', description='', image_url='', pickup_ids=None):
    """ツアー作成"""
    tour = {
        'title': title,
        'date': date,
        'deadline_date': deadline_date,
        'capacity': capacity,
        'price': price,
        'status': status,
        'description': description,
        'image_url': image_url,
        'pickupIds': pickup_ids or [],
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat()
    }
    doc_ref = db.collection('tours').document()
    doc_ref.set(tour)
    return doc_ref.id

def update_tour(tour_id, **kwargs):
    """ツアー更新"""
    kwargs['updatedAt'] = datetime.now().isoformat()
    db.collection('tours').document(tour_id).update(kwargs)
    return True

def delete_tour(tour_id):
    """ツアー削除（紐づく予約も全削除）"""
    # 同じtour_idに紐づく予約をステータス関係なく全削除
    delete_reservations_by_tour(tour_id)
    db.collection('tours').document(tour_id).delete()
    return True

def delete_reservations_by_tour(tour_id):
    """指定ツアーに紐づく予約を全件物理削除（ステータス不問）"""
    docs = db.collection('reservations').where('tour_id', '==', tour_id).stream()
    batch = db.batch()
    batch_count = 0
    deleted_count = 0
    for doc in docs:
        batch.delete(doc.reference)
        batch_count += 1
        deleted_count += 1
        if batch_count >= 500:
            batch.commit()
            batch = db.batch()
            batch_count = 0
    if batch_count > 0:
        batch.commit()
    if deleted_count > 0:
        print(f"ツアー {tour_id} に紐づく予約を全削除: {deleted_count}件")
    return deleted_count

# ---------------------------------
# 乗車地操作
# ---------------------------------
def get_pickups():
    """乗車地一覧取得"""
    query = db.collection('pickups').order_by('sortOrder')
    pickups = []
    for doc in query.stream():
        pickup_data = doc.to_dict()
        pickup_data['id'] = doc.id
        pickups.append(pickup_data)
    return pickups

def create_pickup(name, is_active=True, sort_order=0):
    """乗車地作成"""
    pickup = {
        'name': name,
        'isActive': is_active,
        'sortOrder': sort_order,
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat()
    }
    doc_ref = db.collection('pickups').document()
    doc_ref.set(pickup)
    return doc_ref.id

def update_pickup(pickup_id, **kwargs):
    """乗車地更新"""
    kwargs['updatedAt'] = datetime.now().isoformat()
    db.collection('pickups').document(pickup_id).update(kwargs)
    return True

def delete_pickup(pickup_id):
    """乗車地削除"""
    db.collection('pickups').document(pickup_id).delete()
    return True


def cleanup_old_cancelled_reservations(months=3):
    """キャンセル済み予約のうち、ツアー実施日から指定月数経過したものを物理削除"""
    cutoff_date = datetime.now() - timedelta(days=months * 30)
    cutoff_str = cutoff_date.strftime('%Y-%m-%d')
    
    deleted_count = 0
    try:
        cancelled_docs = db.collection('reservations').where('status', '==', 'cancelled').stream()
        
        batch = db.batch()
        batch_count = 0
        
        for doc in cancelled_docs:
            data = doc.to_dict()
            tour_date = data.get('date', '')
            
            if not tour_date:
                continue
            
            # ツアー実施日が cutoff より古ければ削除対象
            if tour_date < cutoff_str:
                batch.delete(doc.reference)
                batch_count += 1
                deleted_count += 1
                
                if batch_count >= 500:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
        
        if batch_count > 0:
            batch.commit()
        
        if deleted_count > 0:
            print(f"古いキャンセル予約を物理削除: {deleted_count}件（ツアー日から{months}ヶ月以上経過）")
        
        return deleted_count
    
    except Exception as e:
        print(f"キャンセル予約クリーンアップエラー: {e}")
        return 0
