from google.cloud import firestore
from datetime import datetime

db = firestore.Client()

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

def update_reservation_status(reservation_id, new_status):
    """予約ステータス更新"""
    res_doc = db.collection('reservations').document(reservation_id).get()
    if not res_doc.exists:
        return False
    
    res_data = res_doc.to_dict()
    tour_id = res_data.get('tour_id')
    passengers = res_data.get('passengers', 0)
    
    # トランザクション開始
    @firestore.transactional
    def update_with_inventory(transaction):
        # 予約ステータス更新
        transaction.update(
            db.collection('reservations').document(reservation_id),
            {
                'status': new_status,
                'updatedAt': datetime.now().isoformat(),
                'cancelledAt': datetime.now().isoformat() if new_status == 'cancelled' else None
            }
        )
        
        # キャンセル時の在庫復元
        if new_status == 'cancelled' and tour_id:
            tour_doc = db.collection('tours').document(tour_id).get()
            if tour_doc.exists:
                tour_data = tour_doc.to_dict()
                capacity = tour_data.get('capacity', 0)
                status = tour_data.get('status')
                
                # 現在の予約人数（キャンセル対象を除外）
                reservations_ref = db.collection('reservations').where('tour_id', '==', tour_id).where('status', '==', 'confirmed')
                current_count = 0
                for res in reservations_ref.stream():
                    if res.id != reservation_id:  # 自分自身を除外
                        current_count += res.to_dict().get('passengers', 0)
                
                # 定員未満になった場合、full → open に復元
                if status == 'full' and current_count < capacity:
                    transaction.update(
                        db.collection('tours').document(tour_id),
                        {'status': 'open', 'updatedAt': datetime.now().isoformat()}
                    )
    
    transaction = db.transaction()
    update_with_inventory(transaction)
    return True

def create_manual_reservation(tour_id, date, tour_title, passengers, user_info, pickups, preferred_seats, total_price):
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
        'isManualEntry': True,
        'createdAt': datetime.now().isoformat()
    }
    
    doc_ref = db.collection('reservations').document()
    doc_ref.set(reservation)
    
    return doc_ref.id

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
        
        # 現在の予約数をカウント
        reservations_ref = db.collection('reservations').where('tour_id', '==', doc.id).where('status', '==', 'confirmed')
        current_count = sum(res.to_dict().get('passengers', 0) for res in reservations_ref.stream())
        
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

def create_tour(title, date, deadline_date, capacity, price, status='open', description='', image_url=''):
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
    """ツアー削除"""
    db.collection('tours').document(tour_id).delete()
    return True

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
