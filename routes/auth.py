import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from werkzeug.security import generate_password_hash, check_password_hash
from database.db_connection import get_db_connection
from routes.utils import get_default_book_id

router = APIRouter()
logger = logging.getLogger(__name__)


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
    user_id  = data.get('user_id')
    password = data.get('password')
    name     = data.get('name')
    email    = data.get('email')

    if not all([user_id, password, name, email]):
        return JSONResponse({"error": "모든 필드를 입력해주세요."}, status_code=400)

    hashed_password = generate_password_hash(password)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM members WHERE user_id = %s", (user_id,))
            if cursor.fetchone():
                return JSONResponse({"error": "이미 존재하는 아이디입니다."}, status_code=409)
            cursor.execute(
                "INSERT INTO members (user_id, password_hash, name, email) VALUES (%s, %s, %s, %s)",
                (user_id, hashed_password, name, email)
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


@router.post('/login')
async def login(request: Request):
    data = await request.json()
    if not data:
        return JSONResponse({"error": "데이터가 전송되지 않았습니다."}, status_code=400)

    user_id  = data.get('user_id')
    password = data.get('password')

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, user_id, password_hash, name FROM members WHERE user_id = %s",
                (user_id,)
            )
            user = cursor.fetchone()
            if user and check_password_hash(user['password_hash'], password):
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
