import logging
import re
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from werkzeug.security import generate_password_hash, check_password_hash
from database.db_connection import get_db_connection
from routes.utils import get_default_book_id

router = APIRouter()
logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
# E.164: '+' 뒤에 국가번호를 포함해 최대 15자리. 정규화는 프론트가 하고 여기선 형식만 강제한다.
_PHONE_RE = re.compile(r'^\+[1-9]\d{6,14}$')

# ── 로그인 무차별 대입 방어 (아이디별 실패 횟수, 프로세스 로컬) ──
# 프론트 프록시 뒤라 클라이언트 IP를 신뢰하기 어려워 대상 계정(user_id) 기준으로 제한한다.
_LOGIN_MAX = 10       # 윈도우당 최대 실패 횟수
_LOGIN_WINDOW = 300   # 초 (5분)
_login_fails = defaultdict(list)
_login_lock = Lock()


def _login_blocked(key) -> bool:
    now = time.time()
    with _login_lock:
        hits = _login_fails[key]
        hits[:] = [t for t in hits if t > now - _LOGIN_WINDOW]
        return len(hits) >= _LOGIN_MAX


def _login_record_failure(key):
    with _login_lock:
        _login_fails[key].append(time.time())


def _login_reset(key):
    with _login_lock:
        _login_fails.pop(key, None)


# 신규 가구에 시딩할 기본 카테고리 (name, type, sort_order).
_DEFAULT_CATEGORIES = [
    ("저축", "expense", 0), ("기타", "expense", 1), ("취미/문화", "expense", 2),
    ("쇼핑", "expense", 3), ("교통비", "expense", 4), ("식비", "expense", 5),
    ("의료", "expense", 6), ("통신", "expense", 7), ("구독", "expense", 8),
    ("세금/공과금", "expense", 9),
    ("월급", "income", 20), ("그 외", "income", 21), ("투자", "income", 23),
]


def _seed_default_categories(cursor, book_id):
    """새 가구에 기본 카테고리를 시딩한다."""
    cursor.executemany(
        "INSERT INTO categories (account_book_id, name, type, sort_order) VALUES (%s, %s, %s, %s)",
        [(book_id, name, typ, order) for name, typ, order in _DEFAULT_CATEGORIES],
    )


def _create_book_for_member(cursor, member_id, member_name):
    """새 가구(장부) + owner 멤버십 + 기본 카테고리를 생성하고 book id를 반환."""
    cursor.execute(
        "INSERT INTO account_books (member_id, title) VALUES (%s, %s)",
        (member_id, f"{member_name}의 가계부"),
    )
    book_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO account_book_members (account_book_id, member_id, role) VALUES (%s, %s, 'owner')",
        (book_id, member_id),
    )
    _seed_default_categories(cursor, book_id)
    return book_id


@router.post('/register')
async def register(request: Request):
    data = await request.json()
    user_id  = (data.get('user_id') or '').strip()
    password = data.get('password') or ''
    name     = (data.get('name') or '').strip()
    email    = (data.get('email') or '').strip()
    phone    = (data.get('phone') or '').strip()  # 선택 입력

    if not all([user_id, password, name, email]):
        return JSONResponse({"error": "모든 필드를 입력해주세요."}, status_code=400)
    if not (3 <= len(user_id) <= 50):
        return JSONResponse({"error": "아이디는 3~50자여야 합니다."}, status_code=400)
    if not (8 <= len(password) <= 128):
        return JSONResponse({"error": "비밀번호는 8자 이상이어야 합니다."}, status_code=400)
    if len(name) > 50:
        return JSONResponse({"error": "이름이 너무 깁니다."}, status_code=400)
    if len(email) > 100:  # members.email 컬럼이 varchar(100)
        return JSONResponse({"error": "이메일이 너무 깁니다."}, status_code=400)
    if not _EMAIL_RE.match(email):
        return JSONResponse({"error": "이메일 형식이 올바르지 않습니다."}, status_code=400)
    if phone and not _PHONE_RE.match(phone):
        return JSONResponse({"error": "핸드폰 번호 형식이 올바르지 않습니다."}, status_code=400)

    hashed_password = generate_password_hash(password)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # user_id·email 둘 다 UNIQUE 제약이 있어 한 번에 조회한다.
            cursor.execute(
                "SELECT user_id FROM members WHERE user_id = %s OR email = %s",
                (user_id, email),
            )
            for row in cursor.fetchall():
                # 컬럼 콜레이션이 대소문자 무시라 파이썬 비교도 맞춘다.
                if row['user_id'].lower() == user_id.lower():
                    return JSONResponse({"error": "이미 존재하는 아이디입니다."}, status_code=409)
                return JSONResponse({"error": "이미 가입된 이메일입니다."}, status_code=409)
            cursor.execute(
                "INSERT INTO members (user_id, password_hash, name, email, phone) VALUES (%s, %s, %s, %s, %s)",
                (user_id, hashed_password, name, email, phone or None)
            )
            new_member_id = cursor.lastrowid
            _create_book_for_member(cursor, new_member_id, name)
        conn.commit()
        return JSONResponse({"message": "회원가입이 완료되었습니다! 로그인해주세요."}, status_code=201)
    except Exception as e:
        conn.rollback()
        logger.exception("회원가입 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.post('/check-user-id')
async def check_user_id(request: Request):
    """가입 폼의 아이디 중복확인. 사용 가능 여부만 반환한다.

    레이트리밋을 걸지 않았다. 일부러 뺀 것이라 다시 검토할 필요 없다:
    - 프론트(Next) rewrites 뒤라 백엔드가 보는 소켓 주소는 항상 127.0.0.1이다.
      X-Forwarded-For는 정상 요청엔 아예 없고, 클라이언트가 보내면 그 값이 그대로
      통과한다(Next가 `??=`로만 채운다). 실측으로 확인함.
      → IP 기준 제한은 공격자가 헤더만 돌리면 무력화되고, 반대로 정상 사용자는
        전부 한 덩어리로 묶여 서로의 한도를 잡아먹는다. 막지도 못하면서 자해만 한다.
    - 아이디 존재 여부는 이미 /register가 409로 흘리고 있어 여기서 새로 여는 구멍도 아니다.
    제대로 막으려면 앞단에 리버스 프록시를 두고 클라이언트가 보낸 XFF를 버린 뒤
    직접 세팅해야 한다. 그건 인프라 변경이라 별건.
    """
    data = await request.json()
    user_id = (data.get('user_id') or '').strip()

    if not user_id:
        return JSONResponse({"error": "아이디를 입력해주세요."}, status_code=400)
    if not (3 <= len(user_id) <= 50):
        return JSONResponse({"error": "아이디는 3~50자여야 합니다."}, status_code=400)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM members WHERE user_id = %s", (user_id,))
            available = cursor.fetchone() is None
        return JSONResponse({"available": available})
    finally:
        conn.close()


@router.post('/login')
async def login(request: Request):
    data = await request.json()
    if not data:
        return JSONResponse({"error": "데이터가 전송되지 않았습니다."}, status_code=400)

    user_id  = data.get('user_id')
    password = data.get('password')

    if user_id and _login_blocked(user_id):
        return JSONResponse(
            {"error": "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429
        )

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, user_id, password_hash, name FROM members WHERE user_id = %s",
                (user_id,)
            )
            user = cursor.fetchone()
            if user and check_password_hash(user['password_hash'], password):
                _login_reset(user_id)
                book_id = get_default_book_id(cursor, user['id'])
                if book_id is None:
                    # 레거시 유저(장부 없음): 자동 생성
                    book_id = _create_book_for_member(cursor, user['id'], user['name'])
                    conn.commit()
                request.session['user_no']         = user['id']
                request.session['user_id']         = user['user_id']
                request.session['user_name']       = user['name']
                request.session['account_book_id'] = book_id
                return JSONResponse({"message": "로그인 성공"}, status_code=200)
            else:
                _login_record_failure(user_id)
                return JSONResponse({"error": "아이디 또는 비밀번호가 틀립니다."}, status_code=401)
    except Exception as e:
        logger.exception("로그인 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.post('/logout')
async def logout(request: Request):
    request.session.clear()
    return {"message": "로그아웃되었습니다."}


@router.get('/me')
async def me(request: Request):
    user_no = request.session.get('user_no')
    if not user_no:
        return JSONResponse({"error": "로그인이 필요합니다."}, status_code=401)
    return {
        "user_no": user_no,
        "user_id": request.session.get('user_id'),
        "user_name": request.session.get('user_name'),
        "account_book_id": request.session.get('account_book_id'),
    }
