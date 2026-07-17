"""주식 앱(d:\\stock_git) 자동기록 연동 — 토큰 발급 + 거래 수신.

■ 신뢰 모델: 토큰을 **이 앱이 발급한다**
  주식 앱이 JWT 를 서명해 보내는 안을 먼저 검토했으나 기각했다. 그러면 주식 앱이
  이 가계부 데이터의 신원 공급자가 되고, 주식 앱은 공개 회원가입이라
  (stock_git/routes/auth.py:68) 그 가입 정책이 곧 이 가계부의 가입 정책이 된다.
  여기서 발급하면 주식 앱은 "누구의 어느 장부에 쓸지" 를 주장할 수단 자체가 없다.

■ 이 파일이 지키는 4가지 (전부 의도적, 완화하지 말 것)
  1. **세션에 주입하지 않는다.** require_ingest_token 은 토큰 행만 반환하고
     request.session 을 건드리지 않는다. 주식 앱의 auth_token.py:78-81 은 세션에
     user_no 를 주입해 기존 코드를 무수정으로 살리는데, 그 패턴을 여기 복사하면
     이 토큰이 api_require_login 으로 막힌 **모든** 라우트의 열쇠가 된다.
     특히 POST /transaction/reset 은 `DELETE FROM transactions WHERE account_book_id`
     (transaction.py:574) 이고 소유자면 통과한다 → "배당 1건 기록" 토큰이 장부 전멸
     도구가 된다.
  2. **write-only 단일 목적.** 기존 /transaction/add 를 재사용하지 않는다(세션 전제가
     다르다). 이 라우터에는 쓰기 1개만 둔다.
  3. **member_id·account_book_id 는 토큰 행에서 파생.** 요청 본문에서 받지 않는다.
  4. **멱등키 필수.** stock_ingest_ledger 의 UNIQUE 가 중복을 구조적으로 막는다.
     중복은 에러가 아니라 200 + 원래 transaction_id (재시도가 정상 동작해야 한다).

■ 발급: POST /integration/tokens (세션 인증 + 장부 owner 만). 평문은 1회만 반환한다.
"""
import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from database.db_connection import get_db_connection
from routes.utils import (IngestAuthFailed, api_require_login,
                          get_account_book_id, get_user_no, is_book_owner)

router = APIRouter()
logger = logging.getLogger(__name__)

_SOURCES = ('dividend', 'trade')
_MAX_TITLE = 200

# 토큰 기본 수명(일). 평문이 주식 앱 .env 에 상주하고 그 .env 는 오프사이트 백업
# (auto_jobs.job_offsite_backup → OneDrive)에 실리므로 무기한은 과하다.
# 만료되면 재발급 후 .env 를 갱신한다.
_TOKEN_TTL_DAYS = 180

# 원장 텍스트는 AI 어드바이저(/ai/*)의 컨텍스트로 유입된다. 외부 앱이 쓰는 필드이므로
# 종목명·코드 수준의 문자만 허용해 간접 프롬프트 인젝션 표면을 좁힌다.
_TITLE_ALLOWED = re.compile(r'^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ \.\,\(\)\[\]\+\-\:\%\&\/]+$')

_TOKEN_PREFIX = 'gbk_'      # 가계부 발급 키 식별용(로그·유출 스캔에서 알아보기 쉽게)


def _hash_token(plain: str) -> str:
    return hashlib.sha256(plain.encode('utf-8')).hexdigest()


async def require_ingest_token(request: Request) -> dict:
    """Authorization: Bearer <token> 를 검증해 토큰 행을 반환한다.

    ⚠️ request.session 을 건드리지 않는다(파일 헤더 1번). 이 의존성을 쓰는 라우트
    외에는 이 토큰으로 아무 데도 갈 수 없다.
    """
    auth = request.headers.get('authorization', '')
    if not auth.lower().startswith('bearer '):
        raise IngestAuthFailed()
    plain = auth[7:].strip()
    if not plain:
        raise IngestAuthFailed()

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT id, member_id, account_book_id, enabled, expires_at
                   FROM stock_ingest_token WHERE token_hash = %s""",
                (_hash_token(plain),),
            )
            row = cursor.fetchone()
            if not row or not row['enabled']:
                raise IngestAuthFailed()
            if row['expires_at'] and row['expires_at'] < datetime.now():
                raise IngestAuthFailed()
            cursor.execute(
                "UPDATE stock_ingest_token SET last_used_at = NOW() WHERE id = %s",
                (row['id'],),
            )
        conn.commit()
    finally:
        conn.close()
    return row


# ── 토큰 발급 (사람이 브라우저/세션으로 호출) ──────────────────────────

@router.post('/integration/tokens')
async def create_token(request: Request, _=Depends(api_require_login)):
    """연동 토큰 발급. 평문은 이 응답에서만 볼 수 있다(해시만 저장)."""
    user_no = get_user_no(request)
    account_book_id = get_account_book_id(request)
    if account_book_id is None:
        return JSONResponse({"error": "장부를 찾을 수 없습니다."}, status_code=400)

    data = await request.json() if await request.body() else {}
    label = (data.get('label') or 'stock-app').strip()[:50]

    plain = _TOKEN_PREFIX + secrets.token_urlsafe(32)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # 파괴적이진 않으나 쓰기 권한을 주는 행위라 장부 소유자만 허용한다.
            if not is_book_owner(cursor, account_book_id, user_no):
                return JSONResponse({"error": "가구장만 연동 토큰을 발급할 수 있습니다."},
                                    status_code=403)
            expires_at = datetime.now() + timedelta(days=_TOKEN_TTL_DAYS)
            cursor.execute(
                """INSERT INTO stock_ingest_token
                       (token_hash, member_id, account_book_id, label, expires_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                (_hash_token(plain), user_no, account_book_id, label, expires_at),
            )
            token_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    logger.info(f"[stock_ingest] 토큰 발급 id={token_id} member={user_no} "
                f"book={account_book_id} 만료={expires_at:%Y-%m-%d}")
    return JSONResponse({
        "id": token_id,
        "token": plain,          # ← 다시는 볼 수 없다
        "account_book_id": account_book_id,
        "expires_at": expires_at.isoformat(timespec='seconds'),
        "message": "이 토큰은 지금만 표시됩니다. 주식 앱 .env 의 GAGEBU_INGEST_TOKEN 에 저장하세요.",
    }, status_code=201)


@router.get('/integration/tokens')
async def list_tokens(request: Request, _=Depends(api_require_login)):
    """발급된 토큰 목록(해시·평문 없이 메타만)."""
    user_no = get_user_no(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT id, label, account_book_id, enabled, expires_at,
                          last_used_at, created_at
                   FROM stock_ingest_token WHERE member_id = %s ORDER BY id DESC""",
                (user_no,),
            )
            return {"tokens": cursor.fetchall()}
    finally:
        conn.close()


@router.post('/integration/tokens/{token_id}/revoke')
async def revoke_token(token_id: int, request: Request, _=Depends(api_require_login)):
    """토큰 취소. 키 회전·재배포 없이 이 한 줄로 끊긴다."""
    user_no = get_user_no(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE stock_ingest_token SET enabled = 0 WHERE id = %s AND member_id = %s",
                (token_id, user_no),
            )
            affected = cursor.rowcount
        conn.commit()
    finally:
        conn.close()
    if not affected:
        return JSONResponse({"error": "토큰을 찾을 수 없습니다."}, status_code=404)
    logger.info(f"[stock_ingest] 토큰 취소 id={token_id} member={user_no}")
    return {"message": "취소되었습니다."}


# ── 거래 수신 (주식 앱이 호출) ─────────────────────────────────────────

@router.post('/integration/stock/transactions')
async def ingest_transaction(request: Request,
                             token: dict = Depends(require_ingest_token)):
    """주식 앱의 배당·매매를 거래로 기록한다. 멱등.

    member_id·account_book_id 는 **토큰 행에서만** 온다(본문에서 받지 않는다).
    """
    account_book_id = token['account_book_id']
    member_id = token['member_id']

    data = await request.json()
    idem = (data.get('idempotency_key') or '').strip()
    source = (data.get('source') or '').strip()
    type_val = (data.get('type') or '').strip()
    title = (data.get('title') or '').strip()
    date_val = (data.get('date') or '').strip()
    category_hint = (data.get('category_hint') or '').strip()

    if len(idem) != 64 or not re.fullmatch(r'[0-9a-f]{64}', idem):
        return JSONResponse({"error": "idempotency_key 는 sha256 hex 64자여야 합니다."},
                            status_code=400)
    if source not in _SOURCES:
        return JSONResponse({"error": f"source 는 {_SOURCES} 중 하나여야 합니다."},
                            status_code=400)
    if type_val not in ('income', 'expense'):
        return JSONResponse({"error": "type 은 income 또는 expense 여야 합니다."},
                            status_code=400)
    if not title or len(title) > _MAX_TITLE or not _TITLE_ALLOWED.fullmatch(title):
        return JSONResponse({"error": "title 이 비었거나 허용되지 않는 문자를 포함합니다."},
                            status_code=400)
    try:
        # Decimal('NaN') 은 생성자를 통과한다 — 예외는 아래 비교에서 난다(decimal 은
        # <, <= 에 NaN 이 오면 InvalidOperation). 비교를 try 밖에 두면 미처리 500 이 된다.
        amount = Decimal(str(data.get('amount')))
        if not amount.is_finite():
            raise InvalidOperation('NaN/Infinity')
        if amount <= 0 or amount >= Decimal('1000000000000'):
            return JSONResponse({"error": "금액 범위를 벗어났습니다."}, status_code=400)
    except (InvalidOperation, TypeError, ValueError):
        return JSONResponse({"error": "금액이 올바르지 않습니다."}, status_code=400)
    try:
        datetime.strptime(date_val, '%Y-%m-%d')
    except ValueError:
        return JSONResponse({"error": "date 는 YYYY-MM-DD 여야 합니다."}, status_code=400)

    conn = get_db_connection()
    try:
        try:
            with conn.cursor() as cursor:
                # 멱등: 이미 기록했으면 원래 id 를 돌려준다(에러 아님 — 재시도가 정상
                # 동작해야 한다). 원장은 거래를 지워도 남으므로 삭제 후 재삽입도 막힌다.
                cursor.execute(
                    """SELECT transaction_id FROM stock_ingest_ledger
                       WHERE account_book_id = %s AND idempotency_key = %s""",
                    (account_book_id, idem),
                )
                existing = cursor.fetchone()
                if existing:
                    return {"transaction_id": existing['transaction_id'], "duplicate": True}

                category_id = _resolve_category(cursor, account_book_id, type_val,
                                                category_hint)
                cursor.execute(
                    """INSERT INTO transactions
                           (account_book_id, category_id, member_id, type, amount,
                            title, memo, transaction_date, payment_method, user)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (account_book_id, category_id, member_id, type_val, amount, title,
                     '주식 앱 자동기록', date_val, '계좌이체', '공용'),
                )
                txn_id = cursor.lastrowid

                # UNIQUE(account_book_id, idempotency_key) 가 동시 요청 중 하나만
                # 통과시킨다(SELECT→INSERT 가 비원자라 위 조회만으로는 부족하다).
                cursor.execute(
                    """INSERT INTO stock_ingest_ledger
                           (account_book_id, idempotency_key, source, transaction_id,
                            token_id, amount, title)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (account_book_id, idem, source, txn_id, token['id'], amount, title),
                )
            conn.commit()
        except Exception as e:
            conn.rollback()
            # 동시 요청이 UNIQUE 에 걸렸다면 상대가 이미 넣었으므로 그 id 를 돌려준다.
            if 'uq_sil_book_idem' in str(e) or 'Duplicate entry' in str(e):
                with conn.cursor() as cursor:
                    cursor.execute(
                        """SELECT transaction_id FROM stock_ingest_ledger
                           WHERE account_book_id = %s AND idempotency_key = %s""",
                        (account_book_id, idem),
                    )
                    row = cursor.fetchone()
                if row:
                    logger.info(f"[stock_ingest] 동시 요청 dedup book={account_book_id} "
                                f"idem={idem[:12]}")
                    return {"transaction_id": row['transaction_id'], "duplicate": True}
            logger.error(f"[stock_ingest] 기록 실패 book={account_book_id} "
                         f"idem={idem[:12]}: {e}", exc_info=True)
            return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()

    logger.info(f"[stock_ingest] 기록 txn={txn_id} book={account_book_id} "
                f"source={source} amount={amount}")
    return JSONResponse({"transaction_id": txn_id, "duplicate": False}, status_code=201)


# 이 연동이 **만들 수 있는** 카테고리 화이트리스트: (type, name) → 상위 카테고리명(없으면 None).
# category_hint 는 요청 본문에서 오므로, 화이트리스트가 없으면 침해된 주식 앱이 임의
# 이름으로 사용자 장부에 카테고리를 무한히 늘릴 수 있다. 가계부가 목록을 소유한다.
#   매수/매도/배당 은 주식 거래의 3종이고, 사용자가 카테고리별 집계에서 보려면
#   실제 카테고리로 존재해야 한다(category-summary 가 INNER JOIN 이라 미분류는 빠진다).
#   '매도'·'배당' 은 income 이라 기존 '투자' 하위에 둔다(원본 stock_tracker 가 '배당' 을
#   그렇게 만들어 둔 규약을 따른다). '매수' 는 expense 라 상위를 두지 않는다
#   — 부모 '투자' 는 income 타입이어서 타입이 섞이면 안 된다.
_MANAGED_CATEGORIES = {
    ('expense', '매수'): None,
    ('income', '매도'): '투자',
    ('income', '배당'): '투자',
}


def _resolve_category(cursor, account_book_id, type_val, hint):
    """장부 안에서 카테고리 id 를 찾고, 화이트리스트에 있으면 없을 때 만든다.

    카테고리 id 는 장부마다 다르므로 하드코딩할 수 없다(원본 stock_tracker 는
    account_book_id=2 를 상수로 박아 뒀는데 DB 분리로 그 전제가 깨졌다).
    화이트리스트 밖의 힌트는 조회만 하고 만들지 않는다.
    """
    key = (type_val, hint)
    # 화이트리스트를 **조회보다 먼저** 본다. 뒤에 두면 생성은 막히지만 배정은 안 막혀,
    # category_hint='식비' 같은 임의 힌트가 장부의 기존 카테고리에 그대로 붙는다
    # (주식 매수가 식비로 잡혀 집계·AI 분석이 왜곡된다). 가계부가 목록을 소유한다는
    # 설계 의도는 '생성' 뿐 아니라 '배정' 에도 적용돼야 한다.
    if not hint or key not in _MANAGED_CATEGORIES:
        return None                      # 미분류로 기록

    cursor.execute(
        """SELECT id FROM categories
           WHERE account_book_id = %s AND type = %s AND name = %s LIMIT 1""",
        (account_book_id, type_val, hint),
    )
    row = cursor.fetchone()
    if row:
        return row['id']

    parent_id = None
    parent_name = _MANAGED_CATEGORIES[key]
    if parent_name:
        cursor.execute(
            """SELECT id FROM categories
               WHERE account_book_id = %s AND type = %s AND name = %s LIMIT 1""",
            (account_book_id, type_val, parent_name),
        )
        prow = cursor.fetchone()
        parent_id = prow['id'] if prow else None

    cursor.execute(
        "INSERT INTO categories (account_book_id, name, type, parent_id) VALUES (%s, %s, %s, %s)",
        (account_book_id, hint, type_val, parent_id),
    )
    new_id = cursor.lastrowid
    logger.info(f"[stock_ingest] 카테고리 생성 book={account_book_id} "
                f"{type_val}/{hint} parent={parent_id}")
    return new_id
