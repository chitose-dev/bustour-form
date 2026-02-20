import os
from flask import Flask
from flask_cors import CORS
from admin_api import (
    login, get_reservations_api, update_reservation_api, create_reservation_api,
    get_tours_api, create_tour_api, update_tour_api, delete_tour_api,
    get_pickups_api, create_pickup_api, update_pickup_api,
    upload_image_api
)

app = Flask(__name__)
CORS(app)

# ---------------------------------
# 認証エンドポイント
# ---------------------------------
@app.route('/api/admin/login', methods=['POST'])
def login_route():
    return login()

# ---------------------------------
# 予約エンドポイント
# ---------------------------------
@app.route('/api/admin/reservations', methods=['GET'])
def get_reservations_route():
    return get_reservations_api()

@app.route('/api/admin/reservations', methods=['POST'])
def create_reservation_route():
    return create_reservation_api()

@app.route('/api/admin/reservations/<reservation_id>', methods=['PATCH'])
def update_reservation_route(reservation_id):
    return update_reservation_api(reservation_id)

# ---------------------------------
# ツアーエンドポイント
# ---------------------------------
@app.route('/api/admin/tours', methods=['GET'])
def get_tours_route():
    return get_tours_api()

@app.route('/api/admin/tours', methods=['POST'])
def create_tour_route():
    return create_tour_api()

@app.route('/api/admin/tours/<tour_id>', methods=['PATCH'])
def update_tour_route(tour_id):
    return update_tour_api(tour_id)

@app.route('/api/admin/tours/<tour_id>', methods=['DELETE'])
def delete_tour_route(tour_id):
    return delete_tour_api(tour_id)

# ---------------------------------
# 乗車地エンドポイント
# ---------------------------------
@app.route('/api/admin/pickups', methods=['GET'])
def get_pickups_route():
    return get_pickups_api()

@app.route('/api/admin/pickups', methods=['POST'])
def create_pickup_route():
    return create_pickup_api()

@app.route('/api/admin/pickups/<pickup_id>', methods=['PATCH'])
def update_pickup_route(pickup_id):
    return update_pickup_api(pickup_id)

# ---------------------------------
# 画像アップロードエンドポイント
# ---------------------------------
@app.route('/api/admin/images/upload', methods=['POST'])
def upload_image_route():
    return upload_image_api()

# ---------------------------------
# ヘルスチェック
# ---------------------------------
@app.route('/health', methods=['GET'])
def health():
    return {'status': 'ok'}, 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8080)
