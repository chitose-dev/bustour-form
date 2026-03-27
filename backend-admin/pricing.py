from datetime import datetime

PREFERRED_SEAT_PRICE = 500
LINE_DISCOUNT = 100
SPECIAL_MEMBER_DISCOUNT_PER_PERSON = 300


def get_effective_discount(is_special_member, last_minute_enabled, last_minute_amount):
    """
    割引ロジック（パターンB: 有利な方1つのみ適用）
    - 直前割引がON → max(直前割引額, LINE割引100, 特別会員300) を適用
    - 直前割引がOFF → LINE割引100円 or 特別会員300円 を適用
    返却: 1人あたりの割引額
    """
    candidates = [LINE_DISCOUNT]
    if is_special_member:
        candidates.append(SPECIAL_MEMBER_DISCOUNT_PER_PERSON)
    if last_minute_enabled and last_minute_amount and int(last_minute_amount) > 0:
        candidates.append(int(last_minute_amount))
    return max(candidates)


def calculate_total_price(passengers, price_per_person, preferred_seats_count, discount_per_person=0):
    """
    総価格を計算
    passengers: 人数
    price_per_person: 1人あたり料金（定価 listPrice）
    preferred_seats_count: 前列座席指定数
    discount_per_person: 1人あたり割引額
    """
    base_price = passengers * max(price_per_person - discount_per_person, 0)
    seat_upcharge = preferred_seats_count * PREFERRED_SEAT_PRICE
    total = base_price + seat_upcharge

    return {
        'base_price': base_price,
        'seat_upcharge': seat_upcharge,
        'discount_per_person': discount_per_person,
        'discount_total': passengers * discount_per_person,
        'total': total
    }

def aggregate_reservations(reservations):
    """
    予約リストから集計を計算
    返却: {peopleTotal, salesTotal}
    """
    people_total = 0
    sales_total = 0
    
    for res in reservations:
        if res.get('status') == 'confirmed':
            people_total += res.get('passengers', 0)
            sales_total += res.get('totalPrice', 0)
    
    return {
        'peopleTotal': people_total,
        'salesTotal': sales_total
    }
