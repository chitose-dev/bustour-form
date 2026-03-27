from google.cloud import firestore
from datetime import datetime, timedelta, timezone

db = firestore.Client()
SPECIAL_MEMBER_DISCOUNT_PER_PERSON = 300
JST = timezone(timedelta(hours=9))


def now_jst():
    return datetime.now(JST)


def now_jst_iso():
    return now_jst().isoformat(timespec='seconds')

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

def delete_reservation(reservation_id):
    """予約を物理削除。確定済み/申込中の削除時は必要に応じてツアー状態も戻す"""
    res_ref = db.collection('reservations').document(reservation_id)
    res_doc = res_ref.get()
    if not res_doc.exists:
        return False

    res_data = res_doc.to_dict()
    tour_id = res_data.get('tour_id')
    status = res_data.get('status')
    affects_inventory = status in ('confirmed', 'pending')

    @firestore.transactional
    def delete_with_inventory(transaction):
        res_snapshot = res_ref.get(transaction=transaction)
        if not res_snapshot.exists:
            raise ValueError('Reservation not found in transaction')

        if affects_inventory and tour_id:
            tour_ref = db.collection('tours').document(tour_id)
            tour_snapshot = tour_ref.get(transaction=transaction)
            if tour_snapshot.exists:
                tour_data = tour_snapshot.to_dict()
                current_count = 0
                all_reservations = list(db.collection('reservations').where('tour_id', '==', tour_id).stream())
                for current_res in all_reservations:
                    current_data = current_res.to_dict()
                    if current_res.id != reservation_id and current_data.get('status') in ('confirmed', 'pending'):
                        current_count += int(current_data.get('passengers', 0) or 0)

                if tour_data.get('status') == 'full' and current_count < int(tour_data.get('capacity', 0) or 0):
                    transaction.update(tour_ref, {
                        'status': 'open',
                        'updatedAt': now_jst_iso()
                    })

        transaction.delete(res_ref)

    transaction = db.transaction()
    delete_with_inventory(transaction)
    return True

def update_reservation_status(
    reservation_id,
    new_status=None,
    progress_status=None,
    remark=None,
    manual_memo=None,
    name=None,
    phone=None,
    address=None,
    passengers=None,
    pickup=None,
    pickups=None,
    seat_pref=None,
    total_price=None,
    progress_log=None
):
    """予約更新（status / progressStatus / remark / 顧客情報 / 人数 / 乗車地(単数/複数) / 座席 / 金額 / progressLog）"""
    res_doc = db.collection('reservations').document(reservation_id).get()
    if not res_doc.exists:
        return False
    
    res_data = res_doc.to_dict()
    tour_id = res_data.get('tour_id')
    
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
        update_payload = {'updatedAt': now_jst_iso()}
        if new_status is not None:
            update_payload['status'] = new_status
            update_payload['cancelledAt'] = now_jst_iso() if new_status == 'cancelled' else None
        if progress_status is not None:
            update_payload['progressStatus'] = progress_status
        if remark is not None:
            update_payload['remark'] = remark
        if manual_memo is not None:
            update_payload['manualMemo'] = manual_memo
        if progress_log is not None:
            update_payload['progressLog'] = progress_log

        # 予約編集（管理画面）
        if name is not None:
            update_payload['name'] = str(name)
        if phone is not None:
            update_payload['phone'] = str(phone)
        if address is not None:
            update_payload['address'] = str(address)

        normalized_passengers = None
        if passengers is not None:
            normalized_passengers = max(int(passengers), 1)
            update_payload['passengers'] = normalized_passengers
            update_payload['count'] = normalized_passengers

        if pickups is not None:
            normalized_pickups = [str(p).strip() for p in pickups if str(p).strip()]
            update_payload['pickups'] = normalized_pickups
            update_payload['pickup'] = normalized_pickups[0] if normalized_pickups else ''
        elif pickup is not None:
            update_payload['pickup'] = str(pickup)
            update_payload['pickups'] = [str(pickup)] if str(pickup) else []

        if seat_pref is not None:
            update_payload['seat_pref'] = str(seat_pref)
            seat_flag = str(seat_pref) == 'あり'
            seat_count = normalized_passengers if normalized_passengers is not None else max(int(res_snapshot.to_dict().get('passengers', 0) or 0), 1)
            update_payload['preferredSeats'] = [seat_flag] * seat_count

        if total_price is not None:
            normalized_total = max(int(total_price), 0)
            update_payload['totalPrice'] = normalized_total
            update_payload['amount'] = normalized_total

        # userInfo も整合させる
        if name is not None or phone is not None or address is not None:
            current_data = res_snapshot.to_dict() or {}
            current_user_info = current_data.get('userInfo') or {}
            merged_user_info = {
                'name': str(name) if name is not None else current_user_info.get('name', ''),
                'phone': str(phone) if phone is not None else current_user_info.get('phone', ''),
                'pref': current_user_info.get('pref', ''),
                'city': current_user_info.get('city', ''),
                'street': str(address) if address is not None else current_user_info.get('street', '')
            }
            update_payload['userInfo'] = merged_user_info

        transaction.update(res_ref, update_payload)
        
        # キャンセル時の在庫復元
        if new_status == 'cancelled' and tour_id and tour_data:
            capacity = tour_data.get('capacity', 0)
            current_tour_status = tour_data.get('status')
            
            print(f"キャンセル在庫復元: tour={tour_id}, 定員={capacity}, 現在確定人数={current_count}, ツアー状態={current_tour_status}")
            
            if current_tour_status == 'full' and current_count < capacity:
                transaction.update(tour_ref, {
                    'status': 'open',
                    'updatedAt': now_jst_iso()
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
        'updatedAt': now_jst_iso()
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
        'updatedAt': now_jst_iso()
    }, merge=True)

    # 今回編集した予約1件のみに反映（既存の他予約には適用しない）
    _apply_member_discount_to_reservation_doc(target_ref, target_data, bool(enabled))

    return True, '', 1

def create_manual_reservation(tour_id, date, tour_title, passengers, user_info, pickups, preferred_seats, total_price, remark='', special_member=False, member_discount_total=0):
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
        'specialMember': bool(special_member),
        'memberDiscountPerPerson': SPECIAL_MEMBER_DISCOUNT_PER_PERSON if special_member else 0,
        'memberDiscountTotal': int(member_discount_total or 0),
        'isManualEntry': True,
        'createdAt': now_jst_iso()
    }
    
    doc_ref = db.collection('reservations').document()
    doc_ref.set(reservation)
    
    return doc_ref.id

def get_user_active_reservations(line_user_id):
    """ユーザーの有効な予約を取得（開催日が過ぎた予約を除外）"""
    today = now_jst().strftime('%Y-%m-%d')
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

def create_tour(title, date, deadline_date, capacity, price, status='open', description='', image_url='', pickup_ids=None, memo='',
                 list_price=None, last_minute_discount_enabled=False, last_minute_discount_amount=0):
    """ツアー作成"""
    tour = {
        'title': title,
        'date': date,
        'deadline_date': deadline_date,
        'capacity': capacity,
        'price': price,
        'listPrice': list_price if list_price is not None else price + 100,
        'lastMinuteDiscountEnabled': bool(last_minute_discount_enabled),
        'lastMinuteDiscountAmount': int(last_minute_discount_amount or 0),
        'status': status,
        'description': description,
        'image_url': image_url,
        'pickupIds': pickup_ids or [],
        'memo': memo,
        'createdAt': now_jst_iso(),
        'updatedAt': now_jst_iso()
    }
    doc_ref = db.collection('tours').document()
    doc_ref.set(tour)
    return doc_ref.id

def update_tour(tour_id, **kwargs):
    """ツアー更新。title更新時は紐づく予約の tourTitle も同時更新"""
    # listPrice / lastMinuteDiscountEnabled / lastMinuteDiscountAmount の型正規化
    if 'listPrice' in kwargs:
        kwargs['listPrice'] = int(kwargs['listPrice'])
    if 'lastMinuteDiscountEnabled' in kwargs:
        kwargs['lastMinuteDiscountEnabled'] = bool(kwargs['lastMinuteDiscountEnabled'])
    if 'lastMinuteDiscountAmount' in kwargs:
        kwargs['lastMinuteDiscountAmount'] = int(kwargs['lastMinuteDiscountAmount'] or 0)
    kwargs['updatedAt'] = now_jst_iso()
    db.collection('tours').document(tour_id).update(kwargs)
    
    # titleが更新された場合、紐づく予約の tourTitle も更新
    if 'title' in kwargs:
        new_title = kwargs['title']
        reservations = db.collection('reservations').where('tour_id', '==', tour_id).stream()
        batch = db.batch()
        for res_doc in reservations:
            batch.update(res_doc.reference, {'tourTitle': new_title})
        batch.commit()
    
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
        'createdAt': now_jst_iso(),
        'updatedAt': now_jst_iso()
    }
    doc_ref = db.collection('pickups').document()
    doc_ref.set(pickup)
    return doc_ref.id

def update_pickup(pickup_id, **kwargs):
    """乗車地更新"""
    kwargs['updatedAt'] = now_jst_iso()
    db.collection('pickups').document(pickup_id).update(kwargs)
    return True

def delete_pickup(pickup_id):
    """乗車地削除"""
    db.collection('pickups').document(pickup_id).delete()
    return True


def cleanup_old_cancelled_reservations(months=3):
    """キャンセル済み予約のうち、ツアー実施日から指定月数経過したものを物理削除"""
    cutoff_date = now_jst() - timedelta(days=months * 30)
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

# ---------------------------------
# 顧客メモ操作
# ---------------------------------
def get_customer_memo(line_user_id):
    """LINE USER IDに紐づく顧客メモを取得"""
    if not line_user_id:
        return None
    doc = db.collection('customer_memos').document(line_user_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get('memo', '')

def set_customer_memo(line_user_id, memo):
    """LINE USER IDに紐づく顧客メモを保存（永続）"""
    if not line_user_id:
        return False
    db.collection('customer_memos').document(line_user_id).set({
        'lineUserId': line_user_id,
        'memo': memo,
        'updatedAt': now_jst_iso()
    }, merge=True)
    return True
