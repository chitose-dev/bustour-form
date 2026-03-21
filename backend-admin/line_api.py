import os
import time
import hashlib
import hmac
import base64
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

LINE_CHANNEL_TOKEN = os.getenv('LINE_CHANNEL_TOKEN', 'YOUR_LINE_CHANNEL_TOKEN')
LINE_CHANNEL_SECRET = os.getenv('LINE_CHANNEL_SECRET', 'YOUR_LINE_CHANNEL_SECRET')
LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push'
LINE_REPLY_API = 'https://api.line.me/v2/bot/message/reply'
LINE_REQUEST_TIMEOUT = int(os.getenv('LINE_REQUEST_TIMEOUT', '10'))
NOTIFICATION_DEDUP_SECONDS = float(os.getenv('NOTIFICATION_DEDUP_SECONDS', '5'))

RESERVATION_TRIGGER_MESSAGE = '予約確認画面を表示しています...しばらくお待ちください。'

recent_notifications = {}


def create_optimized_session():
    session = requests.Session()

    retry_strategy = Retry(
        total=2,
        backoff_factor=0.2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"]
    )

    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=10,
        pool_maxsize=20,
        pool_block=False
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


optimized_session = create_optimized_session()


def _cleanup_recent_notifications():
    now = time.time()
    expired_keys = [
        key for key, ts in recent_notifications.items()
        if now - ts > NOTIFICATION_DEDUP_SECONDS
    ]
    for key in expired_keys:
        del recent_notifications[key]


def _send_notification_payload(payload):
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {LINE_CHANNEL_TOKEN}'
    }
    response = optimized_session.post(
        LINE_MESSAGING_API,
        json=payload,
        headers=headers,
        timeout=LINE_REQUEST_TIMEOUT
    )
    return response.status_code == 200


def send_notification_once(user_id, message, dedup_key=None):
    """
    短時間の重複送信を抑止して通知を送信
    dedup_key を指定しない場合は user_id + message で判定
    """
    _cleanup_recent_notifications()
    now = time.time()
    key = dedup_key or f"{user_id}:{message}"

    if key in recent_notifications and now - recent_notifications[key] < NOTIFICATION_DEDUP_SECONDS:
        print(f"LINE通知重複抑止: {key}")
        return True

    payload = {
        'to': user_id,
        'messages': [
            {
                'type': 'text',
                'text': message
            }
        ]
    }

    try:
        success = _send_notification_payload(payload)
        if success:
            recent_notifications[key] = now
        return success
    except Exception as e:
        print(f"LINE通知エラー: {e}")
        return False

def send_notification(user_id, message):
    """
    LINE Messaging API で push通知を送信
    user_id: LINE User ID
    message: 送信メッセージテキスト
    """
    return send_notification_once(user_id, message)

def send_reservation_notification(user_id, tour_title, date, passengers, total_price):
    """予約完了通知"""
    message = f"""予約を受け付けました

ツアー名：{tour_title}
日付：{date}
人数：{passengers}名
金額：¥{total_price:,}

キャンセルの際は公式LINEからご連絡ください"""
    return send_notification(user_id, message)

def send_cancellation_notification(user_id, tour_title, date):
    """キャンセル完了通知"""
    message = f"""予約をキャンセルしました

ツアー名：{tour_title}
日付：{date}

ご利用ありがとうございました"""
    return send_notification(user_id, message)


# ---------------------------------
# Webhook処理
# ---------------------------------
def verify_webhook_signature(body_bytes, signature):
    """LINE Webhook署名検証"""
    hash_digest = hmac.new(
        LINE_CHANNEL_SECRET.encode('utf-8'),
        body_bytes,
        hashlib.sha256
    ).digest()
    expected_signature = base64.b64encode(hash_digest).decode('utf-8')
    return hmac.compare_digest(signature, expected_signature)


def reply_message(reply_token, text):
    """LINE Reply APIでメッセージ返信"""
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {LINE_CHANNEL_TOKEN}'
    }
    payload = {
        'replyToken': reply_token,
        'messages': [{'type': 'text', 'text': text}]
    }
    try:
        response = optimized_session.post(
            LINE_REPLY_API,
            json=payload,
            headers=headers,
            timeout=LINE_REQUEST_TIMEOUT
        )
        print(f"Reply API response: {response.status_code}")
        return response.status_code == 200
    except Exception as e:
        print(f"Reply APIエラー: {e}")
        return False


def format_reservation_message(reservations):
    """予約情報をメッセージ形式にフォーマット"""
    if not reservations:
        return """予約情報が見つかりませんでした。

・開催日を過ぎたツアーの予約は表示されません。

・2026年3/21～以降に「予約システム」でご予約された情報のみ表示されます。

お電話や直接LINE等のメッセージでご予約いただいている分は表示されません

ご予約についてご不明点がある場合は、直接LINEメッセージにてお問い合わせください。
新しく予約を作成される場合は「新規予約」ボタンをタップしてください。"""

    blocks = []
    for res in reservations:
        user_info = res.get('userInfo', {})
        name = user_info.get('name', '')
        passengers = res.get('passengers', 0)
        total_price = res.get('totalPrice', 0)
        pickups = res.get('pickups', [])
        status = res.get('status', '')

        status_label_map = {
            'pending': '予約申込中',
            'confirmed': 'ご予約確定',
            'cancelled': 'キャンセル',
            'waitlist': 'キャンセル待ち'
        }
        status_label = status_label_map.get(status, status or '-')

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

        # 前席指定
        preferred_seats = res.get('preferredSeats', [])
        seat_count = len([s for s in preferred_seats if s])
        seat_display = f'あり（{seat_count}名分）' if seat_count > 0 else 'なし'

        block = f"""📅 日付: {res.get('date', '')}
🚌 コース名: {res.get('tourTitle', '')}
📝 ステータス: {status_label}
👤 代表者: {name}様
👥 人数: {passengers}名
💰 料金: ¥{total_price:,}
💺 前列座席: {seat_display}
🚏 乗車地: 
{pickup_display}"""
        blocks.append(block)

    header = "ご予約情報は以下の通りです。\n\n"
    return header + "\n\n━━━━━━━━━━━━━━━\n\n".join(blocks)


def handle_webhook_event(event):
    """Webhookイベントを処理"""
    event_type = event.get('type')
    if event_type != 'message':
        return

    message = event.get('message', {})
    if message.get('type') != 'text':
        return

    text = message.get('text', '').strip()
    reply_token = event.get('replyToken')
    user_id = event.get('source', {}).get('userId')

    if not reply_token or not user_id:
        return

    if text == RESERVATION_TRIGGER_MESSAGE:
        # 遅延インポートで循環参照を回避
        from db import get_user_active_reservations
        reservations = get_user_active_reservations(user_id)
        reply_text = format_reservation_message(reservations)
        reply_message(reply_token, reply_text)
