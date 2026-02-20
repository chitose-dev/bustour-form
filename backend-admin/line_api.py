import os
import requests

LINE_CHANNEL_TOKEN = os.getenv('LINE_CHANNEL_TOKEN', 'YOUR_LINE_CHANNEL_TOKEN')
LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push'

def send_notification(user_id, message):
    """
    LINE Messaging API で push通知を送信
    user_id: LINE User ID
    message: 送信メッセージテキスト
    """
    try:
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {LINE_CHANNEL_TOKEN}'
        }
        payload = {
            'to': user_id,
            'messages': [
                {
                    'type': 'text',
                    'text': message
                }
            ]
        }
        response = requests.post(LINE_MESSAGING_API, json=payload, headers=headers)
        return response.status_code == 200
    except Exception as e:
        print(f"LINE通知エラー: {e}")
        return False

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
