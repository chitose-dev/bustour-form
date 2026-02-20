from datetime import datetime

PREFERRED_SEAT_PRICE = 500

def calculate_total_price(passengers, price_per_person, preferred_seats_count):
    """
    総価格を計算
    passengers: 人数
    price_per_person: 1人あたり料金
    preferred_seats_count: 前列座席指定数
    """
    base_price = passengers * price_per_person
    seat_upcharge = preferred_seats_count * PREFERRED_SEAT_PRICE
    total = base_price + seat_upcharge
    
    return {
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
