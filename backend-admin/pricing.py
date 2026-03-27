from datetime import datetime

PREFERRED_SEAT_PRICE = 500
LINE_DISCOUNT = 100
SPECIAL_MEMBER_DISCOUNT_PER_PERSON = 300


def get_effective_discount(is_special_member: bool, last_minute_enabled: bool, last_minute_amount: int) -> int:
    """
    有利な割引1つを返す（パターンB: 重複なし）
    - LINE割引（100円）は全申込者に適用
    - 特別会員割引（300円）は特別会員のみ
    - 直前割引はONのときのみ候補に入れる
    最も大きい割引1つを適用する
    """
    candidates = [LINE_DISCOUNT]
    if is_special_member:
        candidates.append(SPECIAL_MEMBER_DISCOUNT_PER_PERSON)
    if last_minute_enabled and last_minute_amount > 0:
        candidates.append(int(last_minute_amount))
    return max(candidates)


def calculate_total_price(passengers, list_price, preferred_seats_count,
                          is_special_member=False, last_minute_enabled=False, last_minute_amount=0):
    """
    総価格を計算
    passengers: 人数
    list_price: 定価（1人あたり）
    preferred_seats_count: 前列座席指定数
    is_special_member: 特別会員フラグ
    last_minute_enabled: 直前割引ON/OFF
    last_minute_amount: 直前割引額
    """
    discount = get_effective_discount(is_special_member, last_minute_enabled, last_minute_amount)
    price_per_person = max(list_price - discount, 0)
    base_price = passengers * price_per_person
    seat_upcharge = preferred_seats_count * PREFERRED_SEAT_PRICE
    total = base_price + seat_upcharge

    return {
        'list_price': list_price,
        'discount_per_person': discount,
        'price_per_person': price_per_person,
        'base_price': base_price,
        'seat_upcharge': seat_upcharge,
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
