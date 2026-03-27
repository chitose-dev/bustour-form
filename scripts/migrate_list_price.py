"""
既存全ツアーに listPrice, lastMinuteDiscountEnabled, lastMinuteDiscountAmount を追加するマイグレーション。
listPrice = price + 100 (LINE割引前の定価)
"""
import os
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = '/Users/ogikubo/.openclaw/workspace/bustour-sa-key.json'

from google.cloud import firestore

db = firestore.Client(project='tourreserve')

def migrate():
    tours_ref = db.collection('tours')
    docs = list(tours_ref.stream())
    print(f"対象ツアー数: {len(docs)}")

    updated = 0
    for doc in docs:
        data = doc.to_dict()
        price = data.get('price', 0)
        needs_update = {}

        if 'listPrice' not in data:
            needs_update['listPrice'] = int(price) + 100
        if 'lastMinuteDiscountEnabled' not in data:
            needs_update['lastMinuteDiscountEnabled'] = False
        if 'lastMinuteDiscountAmount' not in data:
            needs_update['lastMinuteDiscountAmount'] = 0

        if needs_update:
            doc.reference.update(needs_update)
            updated += 1
            print(f"  更新: {doc.id} title={data.get('title', '?')} price={price} -> listPrice={needs_update.get('listPrice', data.get('listPrice'))}")

    print(f"\n完了: {updated}/{len(docs)} 件更新")

if __name__ == '__main__':
    migrate()
