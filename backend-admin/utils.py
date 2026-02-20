def format_date(date_str):
    """日付文字列をフォーマット"""
    try:
        from datetime import datetime
        parsed = datetime.strptime(date_str, '%Y-%m-%d')
        return parsed.strftime('%Y年%m月%d日')
    except:
        return date_str

def validate_email(email):
    """メールアドレス検証（簡易版）"""
    return '@' in email if email else False

def paginate_list(items, page=1, per_page=20):
    """リストをページネーション"""
    start = (page - 1) * per_page
    end = start + per_page
    return {
        'items': items[start:end],
        'total': len(items),
        'page': page,
        'per_page': per_page,
        'total_pages': (len(items) + per_page - 1) // per_page
    }
