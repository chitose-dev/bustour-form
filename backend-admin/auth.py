import os
import jwt
import hashlib
from datetime import datetime, timedelta
from functools import wraps
from flask import request, jsonify

JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
# パスワードは環境変数でSHA256ハッシュ値として設定
# 例: echo -n "admin" | shasum -a 256 → 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
ADMIN_PASSWORD_HASH = os.getenv('ADMIN_PASSWORD_HASH', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918')

def hash_password(password):
    """パスワードをSHA256でハッシュ化"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def generate_token(admin_id='admin'):
    """JWT トークン生成"""
    payload = {
        'admin_id': admin_id,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(token):
    """JWT トークン検証"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def require_auth(f):
    """認証デコレータ"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'error': 'unauthorized'}), 401
        
        try:
            scheme, token = auth_header.split(' ')
            if scheme.lower() != 'bearer':
                return jsonify({'error': 'invalid_auth_scheme'}), 401
            
            payload = verify_token(token)
            if not payload:
                return jsonify({'error': 'invalid_or_expired_token'}), 401
        
        except (ValueError, jwt.InvalidTokenError):
            return jsonify({'error': 'invalid_token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated_function

def validate_password(password):
    """パスワード検証（SHA256ハッシュ比較）"""
    if not password:
        return False
    input_hash = hash_password(password)
    return input_hash == ADMIN_PASSWORD_HASH
