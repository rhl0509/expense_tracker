"""
routes/card_import.py — 사용자별 Gmail IMAP 카드 명세서 자동 수집 → 가계부 추가.

각 멤버가 '내 정보'에서 자신의 Gmail 앱 비밀번호(+우리카드 생년월일)를 저장하면
(member_email_credentials, Fernet 암호화) 본인 계정으로만 메일을 파싱한다.
공용 계정을 모든 사용자가 공유하던 구조를 없애 테넌트 간 유출 위험을 제거했다.

  GET    /transaction/card-credentials   → 설정 여부·마스킹된 주소
  POST   /transaction/card-credentials   → {imap_user, imap_password, woori_birth?} 저장
  DELETE /transaction/card-credentials   → 삭제
  POST   /transaction/import/card?days=40 → 본인 저장 자격증명으로 수집·삽입

수집·삽입: 카드사(현대·KB·우리) 명세서 HTML 첨부를 파싱해 이용금액 기준으로
transactions 에 삽입한다. 우리카드는 VestMail 암호화라 저장된 생년월일 6자리로
복호화(vestmail/decrypt.js, node+jsdom)한다. 중복은 (날짜·가맹점·금액·결제수단)
그룹별로 명세서 건수에서 기존 DB 건수를 뺀 만큼만 삽입한다.
"""
import base64
import logging
import time
from collections import Counter, defaultdict
from threading import Event, Lock, Thread

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from config import Config
from database.db_connection import get_db_connection
from routes.utils import (
    get_user_no, get_account_book_id, get_default_book_id, api_require_login,
)
from card_statement import fetch_all_statements, categorize_merchant

router = APIRouter()
logger = logging.getLogger(__name__)

_FALLBACK_CATEGORY = "기타"

# ── 수집 rate limit·삽입 상한 (유저별 슬라이딩 윈도우, 프로세스 로컬) ──
# IMAP 수집은 무겁고 외부 계정에 로그인 시도하므로 남용을 막는다.
_IMPORT_RATE_LIMIT = 5      # 윈도우당 최대 수집 횟수
_IMPORT_RATE_WINDOW = 300   # 초
_MAX_IMPORT_INSERT = 500    # 1회 수집당 삽입 상한
_import_hits = defaultdict(list)
_import_lock = Lock()


def _import_rate_limited(user_no) -> bool:
    now = time.time()
    with _import_lock:
        hits = _import_hits[user_no]
        cutoff = now - _IMPORT_RATE_WINDOW
        hits[:] = [t for t in hits if t > cutoff]
        if len(hits) >= _IMPORT_RATE_LIMIT:
            return True
        hits.append(now)
        return False


# ── 자격증명 암호화 ────────────────────────────────────────────────────
# 세션 서명 키(SECRET_KEY 직접 사용)와 분리하기 위해 HKDF 로 도메인 분리된
# 별도 키를 파생한다. SECRET_KEY 를 교체하면 기존 암호문은 복호화 불가 →
# 사용자가 재입력해야 한다.
def _fernet() -> Fernet:
    raw = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"expense_tracker/card-credentials",
        info=b"member_email_credentials fernet key v1",
    ).derive(Config.SECRET_KEY.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(raw))


def _encrypt(plain: str) -> bytes:
    return _fernet().encrypt(plain.encode("utf-8"))


def _decrypt(token) -> str | None:
    try:
        return _fernet().decrypt(bytes(token)).decode("utf-8")
    except (InvalidToken, TypeError, ValueError):
        return None


def _load_credentials(member_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT imap_user, imap_password_enc, woori_birth_enc
                   FROM member_email_credentials WHERE member_id = %s""",
                (member_id,),
            )
            return cursor.fetchone()
    finally:
        conn.close()


def _mask_email(addr: str) -> str:
    name, _, domain = addr.partition("@")
    if not domain:
        return "****"
    head = name[:2] if len(name) > 2 else name[:1]
    return f"{head}***@{domain}"


# ── 자격증명 CRUD ─────────────────────────────────────────────────────
@router.get("/card-credentials")
async def get_card_credentials(request: Request, _=Depends(api_require_login)):
    row = _load_credentials(get_user_no(request))
    if not row:
        return {"configured": False, "imap_user_masked": None, "has_woori": False}
    return {
        "configured": True,
        "imap_user_masked": _mask_email(row["imap_user"]),
        "has_woori": row["woori_birth_enc"] is not None,
    }


@router.post("/card-credentials")
async def save_card_credentials(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    imap_user = (data.get("imap_user") or "").strip()
    imap_password = (data.get("imap_password") or "").replace(" ", "")
    woori_birth = (data.get("woori_birth") or "").strip()

    if "@" not in imap_user or len(imap_user) > 255:
        return JSONResponse({"error": "올바른 Gmail 주소를 입력하세요."}, status_code=400)
    if not (8 <= len(imap_password) <= 128):
        return JSONResponse({"error": "앱 비밀번호가 올바르지 않습니다."}, status_code=400)
    if woori_birth and (len(woori_birth) != 6 or not woori_birth.isdigit()):
        return JSONResponse({"error": "우리카드 생년월일은 숫자 6자리여야 합니다."}, status_code=400)

    pw_enc = _encrypt(imap_password)
    birth_enc = _encrypt(woori_birth) if woori_birth else None

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """INSERT INTO member_email_credentials
                     (member_id, imap_user, imap_password_enc, woori_birth_enc)
                   VALUES (%s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                     imap_user = VALUES(imap_user),
                     imap_password_enc = VALUES(imap_password_enc),
                     woori_birth_enc = VALUES(woori_birth_enc)""",
                (get_user_no(request), imap_user, pw_enc, birth_enc),
            )
        conn.commit()
    finally:
        conn.close()
    return {"message": "저장되었습니다.", "configured": True}


@router.delete("/card-credentials")
async def delete_card_credentials(request: Request, _=Depends(api_require_login)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM member_email_credentials WHERE member_id = %s",
                (get_user_no(request),),
            )
        conn.commit()
    finally:
        conn.close()
    return {"message": "삭제되었습니다."}


# ── 명세서 수집·삽입 ──────────────────────────────────────────────────
@router.post("/import/card")
async def import_card_statement(request: Request, days: int = 40, _=Depends(api_require_login)):
    user_no = get_user_no(request)
    days = max(1, min(days, 90))

    if _import_rate_limited(user_no):
        return JSONResponse(
            {"error": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429,
        )

    cred = _load_credentials(user_no)
    if not cred:
        return JSONResponse(
            {"error": "카드 연동이 설정되지 않았습니다. 내 정보에서 Gmail 앱 비밀번호를 저장하세요."},
            status_code=400,
        )
    imap_password = _decrypt(cred["imap_password_enc"])
    if imap_password is None:
        return JSONResponse(
            {"error": "저장된 자격증명을 복호화할 수 없습니다. 내 정보에서 다시 저장해주세요."},
            status_code=400,
        )
    woori_birth = _decrypt(cred["woori_birth_enc"]) if cred["woori_birth_enc"] else None

    try:
        rows = fetch_all_statements(
            cred["imap_user"], imap_password, days=days, woori_birth=woori_birth,
        )
    except Exception:
        logger.exception("카드 명세서 메일 수집 실패")
        return JSONResponse({"error": "메일 수집에 실패했습니다. 앱 비밀번호를 확인하세요."}, status_code=502)

    account_book_id = get_account_book_id(request)
    try:
        inserted = _insert_rows(user_no, account_book_id, rows)
    except Exception:
        logger.exception("카드 명세서 저장 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)

    return JSONResponse({
        "parsed": len(rows),
        "inserted": inserted,
        "skipped": len(rows) - inserted,
    }, status_code=200)


# ── 삽입 코어 (HTTP 핸들러·스케줄러 공용) ─────────────────────────────
def _insert_rows(user_no, account_book_id, rows) -> int:
    """파싱된 명세서 rows 를 (날짜·가맹점·금액·결제수단) 그룹 중복 제거 후 삽입.

    각 그룹은 명세서 건수에서 기존 DB 건수를 뺀 만큼만 넣는다. 반환: 삽입 건수.
    실패 시 롤백 후 예외를 그대로 올린다(호출측이 로깅·응답 처리).
    """
    wanted = Counter(
        (r["date"], r["merchant"], r["amount"], r["payment_method"]) for r in rows
    )
    meta = {(r["date"], r["merchant"], r["amount"], r["payment_method"]): r for r in rows}

    inserted = 0
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, name FROM categories WHERE type = 'expense' AND account_book_id = %s",
                (account_book_id,),
            )
            name_to_id = {row["name"]: row["id"] for row in cursor.fetchall()}
            fallback_id = name_to_id.get(_FALLBACK_CATEGORY)

            for key, want_cnt in wanted.items():
                if inserted >= _MAX_IMPORT_INSERT:
                    break
                date_val, merchant, amount, payment_method = key
                cursor.execute(
                    """SELECT COUNT(*) AS c FROM transactions
                       WHERE account_book_id = %s AND transaction_date = %s
                         AND title = %s AND amount = %s AND payment_method = %s""",
                    (account_book_id, date_val, merchant, amount, payment_method),
                )
                existing = cursor.fetchone()["c"]
                to_insert = want_cnt - existing
                if to_insert <= 0:
                    continue
                r = meta[key]
                category_id = name_to_id.get(categorize_merchant(merchant), fallback_id)
                relation = f"/{r['relation']}" if r["relation"] else ""
                memo = f"{r['card']}{relation} · {payment_method} 명세서 자동수집"
                for _ in range(to_insert):
                    if inserted >= _MAX_IMPORT_INSERT:
                        break
                    cursor.execute(
                        """INSERT INTO transactions
                           (account_book_id, category_id, member_id, type, amount,
                            title, memo, transaction_date, payment_method, user)
                           VALUES (%s, %s, %s, 'expense', %s, %s, %s, %s, %s, '공용')""",
                        (account_book_id, category_id, user_no, amount,
                         merchant, memo, date_val, payment_method),
                    )
                    inserted += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


# ── 자동 수집 스케줄러 (하루 1회, 자격증명 보유 멤버 전원) ─────────────
# 이메일 명세서는 카드사가 월 1회만 보내므로 실시간이 아니라 일 1회 폴링으로
# 충분하다. 최근 _SCHED_DAYS 일치를 매번 재수집하되 그룹별 중복 제거로 idempotent.
_SCHED_INTERVAL = 24 * 3600
_SCHED_DAYS = 40
_scheduler_stop = Event()


def _all_credentialed_members():
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT member_id, imap_user, imap_password_enc, woori_birth_enc
                   FROM member_email_credentials"""
            )
            return cursor.fetchall()
    finally:
        conn.close()


def _member_default_book(member_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            return get_default_book_id(cursor, member_id)
    finally:
        conn.close()


def _import_all_members(days: int = _SCHED_DAYS):
    """자격증명을 저장한 모든 멤버의 명세서를 각자 대표 장부로 수집·삽입한다."""
    for member in _all_credentialed_members():
        user_no = member["member_id"]
        try:
            imap_password = _decrypt(member["imap_password_enc"])
            if imap_password is None:
                logger.warning("스케줄 수집 건너뜀: member %s 복호화 실패", user_no)
                continue
            book_id = _member_default_book(user_no)
            if book_id is None:
                continue
            woori_birth = _decrypt(member["woori_birth_enc"]) if member["woori_birth_enc"] else None
            rows = fetch_all_statements(
                member["imap_user"], imap_password, days=days, woori_birth=woori_birth,
            )
            inserted = _insert_rows(user_no, book_id, rows)
            if inserted:
                logger.info("스케줄 수집: member %s +%d건", user_no, inserted)
        except Exception:
            logger.exception("스케줄 수집 실패: member %s", user_no)


def _scheduler_loop():
    # 기동 직후 즉시 돌지 않고 한 주기 뒤부터 실행(기동 폭주·테스트 영향 방지).
    while not _scheduler_stop.wait(_SCHED_INTERVAL):
        try:
            _import_all_members()
        except Exception:
            logger.exception("카드 명세서 스케줄러 주기 실행 실패")


def start_scheduler() -> Thread:
    """백그라운드 데몬 스레드로 자동 수집 스케줄러를 시작한다."""
    _scheduler_stop.clear()
    thread = Thread(target=_scheduler_loop, name="card-import-scheduler", daemon=True)
    thread.start()
    logger.info("카드 명세서 자동 수집 스케줄러 시작 (주기 %d초)", _SCHED_INTERVAL)
    return thread
