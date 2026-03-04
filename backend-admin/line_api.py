import os
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

LINE_CHANNEL_TOKEN = os.getenv('LINE_CHANNEL_TOKEN', 'YOUR_LINE_CHANNEL_TOKEN')
LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push'
LINE_REQUEST_TIMEOUT = int(os.getenv('LINE_REQUEST_TIMEOUT', '10'))
NOTIFICATION_DEDUP_SECONDS = float(os.getenv('NOTIFICATION_DEDUP_SECONDS', '5'))

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
