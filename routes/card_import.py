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
복호화(vestmail/decrypt.js, node+jsdom)한다.

중복방지는 영구 "수집 원장"(card_import_ledger) 기반이다. 라인별 결정적 지문
(날짜·가맹점·금액·결제수단의 SHA-256, statement_fingerprint)을 원장에 기록하고,
원장에 이미 있으면 거래행 존재 여부와 무관하게 건너뛴다 — 사용자가 자동수집
거래를 지우거나(부활 방지) 가맹점명·금액을 고쳐도(이중기장 방지) 재삽입되지
않는다. (장부, 지문, line_seq) UNIQUE 제약이 동시 수집 경쟁도 하나만 통과시킨다.
"""
import base64
import hashlib
import logging
import re
import time
from collections import Counter, defaultdict
from threading import Event, Lock, Thread

from pymysql.err import IntegrityError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Request, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from config import Config
from database.db_connection import get_db_connection
from routes.utils import (
    get_user_no, get_default_book_id, api_require_login,
)
from card_statement import fetch_all_statements, categorize_merchant, verify_imap_login

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

    # 저장하기 전에 실제로 로그인해본다. 형식만 검사하면 "저장됨"이라고 말해놓고
    # 수집이 24시간 뒤 스케줄러 로그에서만 실패한다 — 사용자에겐 조용히 아무 일도
    # 안 일어나는 걸로 보인다(실제로 계정 비밀번호가 두 번 저장된 적이 있다).
    try:
        await run_in_threadpool(verify_imap_login, imap_user, imap_password)
    except Exception as exc:
        detail = str(exc)
        if "Application-specific password required" in detail:
            return JSONResponse(
                {"error": "구글 앱 비밀번호가 필요합니다. 계정 비밀번호가 아니라 "
                          "앱 비밀번호(공백 제외 소문자 16자)를 입력하세요."},
                status_code=400,
            )
        if "AUTHENTICATIONFAILED" in detail or "Invalid credentials" in detail:
            return JSONResponse(
                {"error": "Gmail 로그인에 실패했습니다. 주소와 앱 비밀번호를 확인하세요."},
                status_code=400,
            )
        # 네트워크·Gmail 장애 등은 사용자 입력 잘못이 아니므로 400이 아니다.
        logger.exception("자격증명 검증 중 IMAP 접속 실패")
        return JSONResponse(
            {"error": "Gmail에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."},
            status_code=502,
        )

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
        # IMAP 수집은 수십 초 걸리는 블로킹 IO → 이벤트 루프를 막지 않게 스레드풀에서 실행
        rows = await run_in_threadpool(
            fetch_all_statements,
            cred["imap_user"], imap_password, days=days, woori_birth=woori_birth,
        )
    except Exception:
        logger.exception("카드 명세서 메일 수집 실패")
        return JSONResponse({"error": "메일 수집에 실패했습니다. 앱 비밀번호를 확인하세요."}, status_code=502)

    # 카드 명세서 자동수집은 "내 카드를 내 가계부에 동기화"하는 멤버 단위 기능이므로
    # 세션 활성 장부가 아니라 멤버 대표 장부로 삽입한다(스케줄러와 동일 대상 —
    # 수동/스케줄러가 서로 다른 장부를 타깃해 생기던 장부간 중복(M3) 차단).
    account_book_id = _member_default_book(user_no)
    if account_book_id is None:
        return JSONResponse({"error": "수집 대상 장부를 찾을 수 없습니다."}, status_code=400)
    try:
        # 최대 500건 삽입도 블로킹 DB IO → 스레드풀
        inserted = await run_in_threadpool(_insert_rows, user_no, account_book_id, rows)
    except Exception:
        logger.exception("카드 명세서 저장 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)

    return JSONResponse({
        "parsed": len(rows),
        "inserted": inserted,
        "skipped": len(rows) - inserted,
    }, status_code=200)


# ── 지문(fingerprint) — 수집 원장 중복방지의 핵심 ─────────────────────
# 같은 명세서 라인은 (1) 새로 파싱한 row-dict 에서든 (2) DB 에 이미 저장된
# transactions 행에서든 항상 같은 지문이 나와야 한다(백필 정합 조건).
# 정규화는 migrations/005_card_import_ledger.sql 의 SQL 표현식과 반드시 동일:
#   _norm_text   ↔ LOWER(TRIM(REGEXP_REPLACE(REPLACE(REPLACE(x, NBSP,' '), U+3000,' '),
#                  '[[:space:]]+', ' ')))
#   _norm_amount ↔ TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(x AS CHAR)))
# (자동수집 721행 전수 라운드트립 검증 완료 — 마이그레이션 파일 주석 참고)
_WS_RE = re.compile(r"[ \t\r\n\v\f 　]+")


def _norm_text(s) -> str:
    """공백류(NBSP·전각 포함)를 한 칸으로 접고 양끝 제거 + 소문자."""
    return _WS_RE.sub(" ", str(s)).strip().lower()


def _norm_amount(amount) -> str:
    """파서의 int 와 DB 의 DECIMAL(15,2)가 같은 문자열이 되게 후행 0·점 제거."""
    s = str(amount)
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def statement_fingerprint(date_str, merchant, amount, payment_method) -> str:
    """명세서 라인의 결정적 지문(SHA-256 hex 64자). 스코프(장부)는 포함하지 않고
    원장 UNIQUE 키의 account_book_id 컬럼으로 건다."""
    base = "|".join((
        str(date_str), _norm_text(merchant), _norm_amount(amount),
        _norm_text(payment_method),
    ))
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _ledger_lines(rows):
    """rows → [(fingerprint, line_seq, row), ...].

    같은 명세서에 완전 동일 라인이 n번 나올 수 있어(예: 오락실 1,000원 x10)
    지문만으로는 다건을 구분 못 한다 → 명세서(첨부, row['_stmt']) 단위로 지문별
    1..n 의 line_seq 를 부여한다. 재발송 등으로 같은 명세서가 배치에 두 번 들어와도
    (지문, seq) 셋이 같아져 자연히 한 벌로 접힌다.
    """
    per_stmt = Counter()
    seen = set()
    out = []
    for r in rows:
        fp = statement_fingerprint(
            r["date"], r["merchant"], r["amount"], r["payment_method"]
        )
        per_stmt[(r.get("_stmt"), fp)] += 1
        seq = per_stmt[(r.get("_stmt"), fp)]
        if (fp, seq) in seen:
            continue
        seen.add((fp, seq))
        out.append((fp, seq, r))
    return out


# ── 삽입 코어 (HTTP 핸들러·스케줄러 공용) ─────────────────────────────
def _insert_rows(user_no, account_book_id, rows) -> int:
    """파싱된 명세서 rows 를 수집 원장(card_import_ledger) 기준으로 중복 제거 후 삽입.

    라인별 지문이 원장에 있으면 거래행 존재 여부와 무관하게 skip(삭제 부활·수정
    이중기장 방지). 없으면 (원장 INSERT + 거래 INSERT)를 한 트랜잭션으로 커밋한다.
    원장 UNIQUE 가 동시 수집 경쟁을 중재한다: 늦은 쪽은 duplicate-key(1062)로 skip.
    반환: 삽입 건수. 실패 시 롤백 후 예외를 그대로 올린다(호출측이 로깅·응답 처리).
    """
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

            for fp, seq, r in _ledger_lines(rows):
                if inserted >= _MAX_IMPORT_INSERT:
                    break
                try:
                    cursor.execute(
                        """INSERT INTO card_import_ledger
                           (account_book_id, fingerprint, line_seq, transaction_date,
                            merchant, amount, payment_method, member_id)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (account_book_id, fp, seq, r["date"], r["merchant"],
                         r["amount"], r["payment_method"], user_no),
                    )
                except IntegrityError as exc:
                    if exc.args[0] != 1062:  # 1062 = duplicate key
                        raise
                    # 이미 수집된 라인(원장에 지문 존재) — 거래행이 지워졌어도 skip.
                    cursor.execute(
                        """UPDATE card_import_ledger
                           SET last_seen_at = CURRENT_TIMESTAMP
                           WHERE account_book_id = %s AND fingerprint = %s
                             AND line_seq = %s""",
                        (account_book_id, fp, seq),
                    )
                    conn.commit()
                    continue
                ledger_id = cursor.lastrowid
                category_id = name_to_id.get(categorize_merchant(r["merchant"]), fallback_id)
                relation = f"/{r['relation']}" if r["relation"] else ""
                memo = f"{r['card']}{relation} · {r['payment_method']} 명세서 자동수집"
                cursor.execute(
                    """INSERT INTO transactions
                       (account_book_id, category_id, member_id, type, amount,
                        title, memo, transaction_date, payment_method, user)
                       VALUES (%s, %s, %s, 'expense', %s, %s, %s, %s, %s, '공용')""",
                    (account_book_id, category_id, user_no, r["amount"],
                     r["merchant"], memo, r["date"], r["payment_method"]),
                )
                cursor.execute(
                    "UPDATE card_import_ledger SET transaction_id = %s WHERE id = %s",
                    (cursor.lastrowid, ledger_id),
                )
                conn.commit()  # (원장 + 거래) 한 쌍을 원자적으로 확정
                inserted += 1
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return inserted


# ── 자동 수집 스케줄러 (하루 1회, 자격증명 보유 멤버 전원) ─────────────
# 이메일 명세서는 카드사가 월 1회만 보내므로 실시간이 아니라 일 1회 폴링으로
# 충분하다. 최근 _SCHED_DAYS 일치를 매번 재수집하되 수집 원장 지문으로 idempotent.
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


def _seconds_until_next_run() -> float:
    """다음 실행까지 남은 초. 한 번도 안 돌았거나 주기가 지났으면 0.

    경과 시간은 DB의 NOW()로 계산한다 — 앱과 DB의 시계·타임존이 어긋나도 안전하다.
    """
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT TIMESTAMPDIFF(SECOND, last_run_at, NOW()) AS elapsed "
                    "FROM card_import_schedule WHERE id = 1"
                )
                row = cursor.fetchone()
        finally:
            conn.close()
    except Exception:
        # 테이블 누락(마이그레이션 미적용)·DB 장애 등. 0을 주면 바쁜 루프가 되므로
        # 한 주기 쉬고 다시 본다.
        logger.exception("스케줄러: 마지막 실행 시각 조회 실패 — 한 주기 대기")
        return _SCHED_INTERVAL
    if not row or row["elapsed"] is None:
        return 0.0
    return max(0.0, _SCHED_INTERVAL - float(row["elapsed"]))


def _mark_run():
    """실행을 시도했음을 기록한다. 실패해도 남긴다 — 안 남기면 대기가 0이 되어
    실패가 계속될 때 IMAP을 쉬지 않고 두드리는 바쁜 루프가 된다."""
    try:
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO card_import_schedule (id, last_run_at) VALUES (1, NOW()) "
                    "ON DUPLICATE KEY UPDATE last_run_at = NOW()"
                )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        logger.exception("스케줄러: 마지막 실행 시각 기록 실패")


def _scheduler_loop():
    # 대기 시간을 DB의 마지막 실행 시각에서 계산한다. 재시작해도 주기가 리셋되지
    # 않고, 기동 시 이미 주기가 지났으면 즉시 1회 돈다.
    while True:
        delay = _seconds_until_next_run()
        logger.info("카드 자동수집: 다음 실행까지 %.0f분", delay / 60)
        if _scheduler_stop.wait(delay):
            return
        try:
            _import_all_members()
        except Exception:
            logger.exception("카드 명세서 스케줄러 주기 실행 실패")
        finally:
            _mark_run()


def start_scheduler() -> Thread:
    """백그라운드 데몬 스레드로 자동 수집 스케줄러를 시작한다."""
    _scheduler_stop.clear()
    thread = Thread(target=_scheduler_loop, name="card-import-scheduler", daemon=True)
    thread.start()
    logger.info("카드 명세서 자동 수집 스케줄러 시작 (주기 %d초)", _SCHED_INTERVAL)
    return thread
