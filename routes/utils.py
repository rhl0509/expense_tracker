# routes/utils.py — FastAPI 공통 유틸리티
from fastapi import Request
from database.db_connection import get_db_connection


# ── 커스텀 예외 (의존성에서 raise → 앱 레벨 핸들러가 처리) ──

class LoginRequired(Exception):
    """HTML 페이지 라우트: 미인증 → /login 리다이렉트."""

class ApiLoginRequired(Exception):
    """JSON API 라우트: 미인증 → 401 JSON."""

class BookAccessDenied(Exception):
    """현재 유저가 해당 가구(account_book)의 멤버가 아님 → 403."""


# ── 의존성 함수 ──

async def require_login(request: Request):
    """HTML 페이지용 로그인 체크 의존성."""
    if "user_no" not in request.session:
        raise LoginRequired()


async def api_require_login(request: Request):
    """JSON API용 로그인 체크 의존성."""
    if "user_no" not in request.session:
        raise ApiLoginRequired()


# ── 세션 헬퍼 (request를 명시적으로 전달) ──

def get_user_no(request: Request):
    return request.session.get("user_no")


# ── 가구(account_book) 멤버십 헬퍼 ──

def get_default_book_id(cursor, member_id):
    """유저가 속한 가구 중 대표 장부(owner 우선, 그다음 낮은 id)."""
    cursor.execute(
        """SELECT account_book_id FROM account_book_members
           WHERE member_id = %s
           ORDER BY (role = 'owner') DESC, account_book_id ASC LIMIT 1""",
        (member_id,),
    )
    row = cursor.fetchone()
    return row["account_book_id"] if row else None


def is_book_member(cursor, account_book_id, member_id):
    cursor.execute(
        "SELECT 1 FROM account_book_members WHERE account_book_id = %s AND member_id = %s",
        (account_book_id, member_id),
    )
    return cursor.fetchone() is not None


def is_book_owner(cursor, account_book_id, member_id):
    cursor.execute(
        "SELECT 1 FROM account_book_members WHERE account_book_id = %s AND member_id = %s AND role = 'owner'",
        (account_book_id, member_id),
    )
    return cursor.fetchone() is not None


def get_account_book_id(request: Request):
    """세션의 활성 가구 id. 세션에 없으면 DB에서 대표 장부를 찾아 캐시한다.

    account_book_id는 로그인/장부전환 시 멤버십을 검증한 값만 서명된 세션에 기록되므로,
    읽기 시점에는 세션 값을 신뢰한다(쿠키는 위조 불가).
    """
    book_id = request.session.get("account_book_id")
    if book_id is not None:
        return book_id
    member_id = request.session.get("user_no")
    if member_id is None:
        return None
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            book_id = get_default_book_id(cursor, member_id)
    finally:
        conn.close()
    if book_id is not None:
        request.session["account_book_id"] = book_id
    return book_id
