import hashlib
import hmac
import logging
import re
import secrets
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from werkzeug.security import generate_password_hash, check_password_hash
from config import Config
from database.db_connection import get_db_connection
from routes.mailer import send_email
from routes.utils import api_require_login, get_default_book_id, get_user_no

router = APIRouter()
logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# 이메일 인증코드 설정. 코드는 세션에 해시로만 저장한다 — Starlette 세션 쿠키는 서명만 되고
# 내용은 클라이언트가 디코드해 읽을 수 있어, 평문 코드를 넣으면 메일 없이도 통과된다.
_EMAIL_CODE_TTL = 300          # 코드 유효 시간(초) = 5분
_EMAIL_RESEND_COOLDOWN = 60    # 재발송 최소 간격(초)
_EMAIL_MAX_ATTEMPTS = 5        # 코드 검증 최대 시도 횟수


def _email_code_hash(email: str, code: str) -> str:
    """SECRET_KEY 로 (이메일, 코드)를 HMAC-SHA256 한다. 세션에 이 해시만 저장한다."""
    payload = f"{email.strip().lower()}:{code}".encode()
    return hmac.new(Config.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()

# 현재 시행 중인 약관 버전(시행일). 문서를 개정하면 여기와 프론트 페이지(/terms /privacy)를
# 함께 올린다 — member_consents 에 "어떤 버전에 동의했는지"로 기록된다.
TERMS_VERSION = '2026-07-20'
PRIVACY_VERSION = '2026-07-20'
# E.164: '+' 뒤에 국가번호를 포함해 최대 15자리. 정규화는 프론트가 하고 여기선 형식만 강제한다.
_PHONE_RE = re.compile(r'^\+[1-9]\d{6,14}$')

# 계정 비밀번호 규칙. 카드 연동의 Gmail 앱 비밀번호(card_import.py)는 소문자 16자라
# 이 규칙을 쓰면 안 된다 — 여기는 가입 비밀번호 전용이다.
_PW_RULES = (
    (re.compile(r'[a-z]'), '영문 소문자'),
    (re.compile(r'[A-Z]'), '영문 대문자'),
    (re.compile(r'\d'), '숫자'),
    (re.compile(r'[^A-Za-z0-9]'), '특수문자'),
)


def _password_error(password: str) -> str | None:
    """규칙 위반이면 사용자에게 보일 문구를, 통과면 None을 반환한다."""
    if not (8 <= len(password) <= 128):
        return "비밀번호는 8~128자여야 합니다."
    missing = [label for rx, label in _PW_RULES if not rx.search(password)]
    if missing:
        return f"비밀번호에 {'·'.join(missing)}를 포함해야 합니다."
    return None

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
        if not hits:
            # 빈 리스트 키가 무한 누적되지 않게 제거(무인증 임의 user_id 로 메모리 성장 방지).
            del _login_fails[key]
            return False
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
    pw_error = _password_error(password)
    if pw_error:
        return JSONResponse({"error": pw_error}, status_code=400)
    if len(name) > 50:
        return JSONResponse({"error": "이름이 너무 깁니다."}, status_code=400)
    if len(email) > 100:  # members.email 컬럼이 varchar(100)
        return JSONResponse({"error": "이메일이 너무 깁니다."}, status_code=400)
    if not _EMAIL_RE.match(email):
        return JSONResponse({"error": "이메일 형식이 올바르지 않습니다."}, status_code=400)
    if phone and not _PHONE_RE.match(phone):
        return JSONResponse({"error": "핸드폰 번호 형식이 올바르지 않습니다."}, status_code=400)
    # 이메일 인증을 프론트뿐 아니라 서버에서도 강제한다 — API 를 직접 때려도 인증 없이는 못 가입한다.
    # 인증 성공 시 세션에 남긴 email_verified 가 제출 이메일과 일치해야 한다.
    if (request.session.get('email_verified') or '').strip().lower() != email.lower():
        return JSONResponse({"error": "이메일 인증을 완료해주세요."}, status_code=400)
    # 프론트 체크박스만 믿지 않는다 — 직접 API 를 때려도 동의 없이는 가입할 수 없다.
    if not (data.get('terms_agreed') is True and data.get('privacy_agreed') is True):
        return JSONResponse({"error": "이용약관과 개인정보처리방침에 동의해주세요."}, status_code=400)

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
                # 소셜 전용 회원은 user_id 가 NULL — 이메일로 걸린 행이므로 이메일 중복이다.
                if row['user_id'] and row['user_id'].lower() == user_id.lower():
                    return JSONResponse({"error": "이미 존재하는 아이디입니다."}, status_code=409)
                return JSONResponse({"error": "이미 가입된 이메일입니다."}, status_code=409)
            cursor.execute(
                "INSERT INTO members (user_id, password_hash, name, email, phone) VALUES (%s, %s, %s, %s, %s)",
                (user_id, hashed_password, name, email, phone or None)
            )
            new_member_id = cursor.lastrowid
            # 동의 이력은 가입과 같은 트랜잭션으로 남긴다 — 동의 기록 없는 회원이 생기지 않게.
            cursor.executemany(
                "INSERT INTO member_consents (member_id, doc, version) VALUES (%s, %s, %s)",
                [
                    (new_member_id, 'terms', TERMS_VERSION),
                    (new_member_id, 'privacy', PRIVACY_VERSION),
                ],
            )
            _create_book_for_member(cursor, new_member_id, name)
        conn.commit()
        # 가입 완료 — 인증 세션 흔적을 정리한다.
        request.session.pop('email_verified', None)
        request.session.pop('email_verify', None)
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


@router.post('/send-email-code')
async def send_email_code(request: Request):
    """회원가입 이메일 인증코드 발송. 이미 가입된 이메일이면 409(중복확인 겸용).

    코드는 세션에 해시로만 저장하고, 60초 재발송 쿨다운을 둔다. SMTP 미설정이면
    routes.mailer 가 코드를 서버 로그로 대체 출력한다(개발용).
    """
    data = await request.json()
    email = (data.get('email') or '').strip()
    if not email or not _EMAIL_RE.match(email):
        return JSONResponse({"error": "이메일 형식이 올바르지 않습니다."}, status_code=400)
    if len(email) > 100:
        return JSONResponse({"error": "이메일이 너무 깁니다."}, status_code=400)

    # 이미 가입된 이메일이면 코드를 보내지 않는다(가입 전 중복확인).
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM members WHERE email = %s", (email,))
            if cursor.fetchone():
                return JSONResponse({"error": "이미 가입된 이메일입니다."}, status_code=409)
    finally:
        conn.close()

    now = time.time()
    pending = request.session.get('email_verify')
    if pending and pending.get('email', '').lower() == email.lower():
        elapsed = now - pending.get('sent_at', 0)
        if elapsed < _EMAIL_RESEND_COOLDOWN:
            wait = int(_EMAIL_RESEND_COOLDOWN - elapsed) or 1
            return JSONResponse({"error": f"잠시 후 다시 시도해주세요. ({wait}초)"}, status_code=429)

    code = f"{secrets.randbelow(1000000):06d}"
    request.session['email_verify'] = {
        'email': email,
        'code_hash': _email_code_hash(email, code),
        'expires': now + _EMAIL_CODE_TTL,
        'sent_at': now,
        'attempts': 0,
    }
    # 새 코드를 보냈으니 이전 인증완료 표시는 무효화한다(다른 이메일로 바꿨을 수 있음).
    request.session.pop('email_verified', None)

    subject = "[AI 가계부] 이메일 인증 코드"
    body = (
        f"인증 코드: {code}\n\n"
        f"회원가입 화면에 위 6자리 코드를 5분 안에 입력해주세요.\n"
        f"본인이 요청하지 않았다면 이 메일을 무시하세요."
    )
    try:
        await run_in_threadpool(send_email, email, subject, body)
    except Exception:
        logger.exception("인증 메일 발송 실패")
        return JSONResponse({"error": "메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요."}, status_code=502)

    return JSONResponse({"message": "인증 코드를 보냈습니다. 메일함을 확인해주세요."})


@router.post('/verify-email-code')
async def verify_email_code(request: Request):
    """발송한 코드를 검증한다. 성공하면 세션에 email_verified 를 남겨 register 가 확인한다."""
    data = await request.json()
    email = (data.get('email') or '').strip()
    code = (data.get('code') or '').strip()

    # 실질 무차별 대입 방어는 서버측 카운터다(세션 attempts 는 쿠키 리플레이로 초기화됨).
    # 아이디/비번 찾기와 같은 _code_fail_hits 를 공유한다(정의는 아래 회복 섹션, 호출 시점엔 로드 완료).
    if _hits_blocked(_code_fail_hits, email.lower(), _CODE_FAIL_WINDOW, _CODE_FAIL_MAX):
        return JSONResponse({"error": "인증 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."}, status_code=429)

    pending = request.session.get('email_verify')
    if not pending or pending.get('email', '').lower() != email.lower():
        return JSONResponse({"error": "인증 코드를 먼저 요청해주세요."}, status_code=400)
    if time.time() > pending.get('expires', 0):
        request.session.pop('email_verify', None)
        return JSONResponse({"error": "인증 코드가 만료되었습니다. 다시 요청해주세요."}, status_code=400)
    if pending.get('attempts', 0) >= _EMAIL_MAX_ATTEMPTS:
        request.session.pop('email_verify', None)
        return JSONResponse({"error": "시도 횟수를 초과했습니다. 코드를 다시 요청해주세요."}, status_code=429)

    # 시도 횟수를 먼저 올려 세션에 반영한다(무차별 대입 방지, UX 보조).
    pending['attempts'] = pending.get('attempts', 0) + 1
    request.session['email_verify'] = pending

    if not code or not hmac.compare_digest(pending['code_hash'], _email_code_hash(email, code)):
        _hits_record(_code_fail_hits, email.lower())
        return JSONResponse({"error": "인증 코드가 올바르지 않습니다."}, status_code=400)

    _hits_reset(_code_fail_hits, email.lower())
    request.session.pop('email_verify', None)
    request.session['email_verified'] = email
    return JSONResponse({"message": "이메일 인증이 완료되었습니다.", "verified": True})


# ── 아이디/비밀번호 찾기 (이메일 인증) ──────────────────────────────────────
# 회원가입 인증(email_verify)과 세션 키를 분리해 서로 재사용되지 않게 한다. 코드는 가입 인증과
# 같은 방식으로 세션에 HMAC 해시로만 저장한다(_email_code_hash). TTL·쿨다운·시도 제한도 동일.
#
# 계정 존재 여부는 정직하게 응답한다(일치 없으면 404). 이 앱은 가입(409)·아이디 중복확인에서
# 이미 존재 여부를 노출하는 방침이라 여기만 숨기면 UX만 나빠지고 실익이 없다. 실제 민감 동작
# (아이디 공개·비밀번호 변경)은 메일함을 가진 본인만 코드를 받아 통과할 수 있어 보호된다.
_RECOVER_CODE_TTL = 300          # 코드 유효 시간(초) = 5분
_RECOVER_RESEND_COOLDOWN = 60    # 재발송 최소 간격(초)
_RECOVER_MAX_ATTEMPTS = 5        # 코드 검증 최대 시도 횟수(세션 기준, UX용)
_PW_RESET_WINDOW = 600           # 코드 검증 후 새 비밀번호 설정까지 허용 시간(초) = 10분

# ── 서버측 레이트 제한 (프로세스 로컬) — 로그인 방어(_login_fails)와 같은 방식 ──
# 세션 쿠키에 담은 시도 카운터(attempts)는 실제 방어선이 될 수 없다: Starlette 세션은 서명만
# 되고 서버 저장소가 없어, 공격자가 attempts=0 인 오래된 쿠키를 리플레이하면 카운터가 매번
# 초기화된다 → 6자리 코드를 무제한 대입할 수 있다. 그래서 코드 검증 실패·메일 발송 횟수는
# 세션이 아니라 서버가 직접 이메일 기준으로 센다. (login 처럼 프로세스 로컬이라 다중 워커에는
# 공유되지 않는다 — 이 앱은 단일 프로세스 전제로, 로그인 방어도 같은 가정을 쓴다.)
_CODE_FAIL_MAX = 10       # 이메일별 코드 검증 실패 상한(윈도우당)
_CODE_FAIL_WINDOW = 600   # 초 (10분) — 코드 TTL(5분)보다 길게 잡아 재발송해도 누적되게
_SEND_MAX = 5             # 이메일별 코드 발송 상한(윈도우당) — 메일 폭탄 방지
_SEND_WINDOW = 600        # 초 (10분)
_code_fail_hits = defaultdict(list)   # email -> [검증 실패 시각]
_send_hits = defaultdict(list)        # email -> [발송 시각]
_recover_lock = Lock()


def _hits_blocked(store, key: str, window: int, limit: int) -> bool:
    """윈도우 내 기록이 limit 이상이면 True. 오래된 기록은 청소하고 빈 키는 제거한다."""
    now = time.time()
    with _recover_lock:
        hits = store[key]
        hits[:] = [t for t in hits if t > now - window]
        if not hits:
            del store[key]   # 무인증 임의 이메일로 딕셔너리가 무한 성장하지 않게
            return False
        return len(hits) >= limit


def _hits_record(store, key: str) -> None:
    with _recover_lock:
        store[key].append(time.time())


def _hits_reset(store, key: str) -> None:
    with _recover_lock:
        store.pop(key, None)


def _recover_cooldown_left(pending, email: str, now: float) -> int:
    """같은 이메일로 재발송하려 할 때 남은 쿨다운 초. 0이면 발송 가능."""
    if pending and pending.get('email', '').lower() == email.lower():
        elapsed = now - pending.get('sent_at', 0)
        if elapsed < _RECOVER_RESEND_COOLDOWN:
            return int(_RECOVER_RESEND_COOLDOWN - elapsed) or 1
    return 0


def _recover_store_and_mail(request: Request, session_key: str, email: str,
                            subject: str, purpose: str, extra: dict):
    """복구 코드를 세션에 해시로 저장하고 메일을 보낸다. 발송 실패 시 예외를 올린다.

    extra 는 세션에 함께 저장할 추가 필드(예: 비밀번호 찾기의 member_id). 세션 쿠키는 서명만
    되고 내용은 클라이언트가 읽을 수 있으므로, 코드 평문이나 비밀 값은 넣지 않는다.
    """
    now = time.time()
    code = f"{secrets.randbelow(1000000):06d}"
    request.session[session_key] = {
        'email': email,
        'code_hash': _email_code_hash(email, code),
        'expires': now + _RECOVER_CODE_TTL,
        'sent_at': now,
        'attempts': 0,
        **extra,
    }
    body = (
        f"인증 코드: {code}\n\n"
        f"{purpose} 화면에 위 6자리 코드를 5분 안에 입력해주세요.\n"
        f"본인이 요청하지 않았다면 이 메일을 무시하세요."
    )
    send_email(email, subject, body)


def _recover_check_code(request: Request, session_key: str, email: str, code: str):
    """세션에 저장된 복구 코드를 검증한다. (pending_dict, None) 또는 (None, 오류응답)을 반환.

    verify_email_code 와 같은 규율: 만료·시도초과·불일치를 각각 처리하고, 성공 시 세션 항목을
    지워 재사용을 막는다. 실제 무차별 대입 방어는 세션의 attempts 가 아니라 서버측
    _code_fail_hits 카운터다(세션 카운터는 쿠키 리플레이로 초기화되므로 UX 보조일 뿐).
    """
    # 서버측 카운터가 실질 방어선. 이메일 기준으로 실패를 세어 쿠키 리플레이를 무력화한다.
    if _hits_blocked(_code_fail_hits, email.lower(), _CODE_FAIL_WINDOW, _CODE_FAIL_MAX):
        return None, JSONResponse(
            {"error": "인증 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."}, status_code=429
        )

    pending = request.session.get(session_key)
    if not pending or pending.get('email', '').lower() != email.lower():
        return None, JSONResponse({"error": "인증 코드를 먼저 요청해주세요."}, status_code=400)
    if time.time() > pending.get('expires', 0):
        request.session.pop(session_key, None)
        return None, JSONResponse({"error": "인증 코드가 만료되었습니다. 다시 요청해주세요."}, status_code=400)
    if pending.get('attempts', 0) >= _RECOVER_MAX_ATTEMPTS:
        request.session.pop(session_key, None)
        return None, JSONResponse({"error": "시도 횟수를 초과했습니다. 코드를 다시 요청해주세요."}, status_code=429)

    pending['attempts'] = pending.get('attempts', 0) + 1
    request.session[session_key] = pending

    if not code or not hmac.compare_digest(pending['code_hash'], _email_code_hash(email, code)):
        _hits_record(_code_fail_hits, email.lower())
        return None, JSONResponse({"error": "인증 코드가 올바르지 않습니다."}, status_code=400)

    _hits_reset(_code_fail_hits, email.lower())
    verified = dict(pending)
    request.session.pop(session_key, None)
    return verified, None


@router.post('/find-id/send-code')
async def find_id_send_code(request: Request):
    """아이디 찾기 — 이름+이메일이 일치하는 계정의 이메일로 인증 코드를 보낸다."""
    data = await request.json()
    name  = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip()
    if not name or not email or not _EMAIL_RE.match(email):
        return JSONResponse({"error": "이름과 이메일을 정확히 입력해주세요."}, status_code=400)
    if len(email) > 100:
        return JSONResponse({"error": "이메일이 너무 깁니다."}, status_code=400)

    now = time.time()
    # 발송 상한은 서버측 카운터로 강제한다 — 세션 쿨다운(아래)은 쿠키를 생략하면 우회되므로
    # 메일 폭탄을 막지 못한다.
    if _hits_blocked(_send_hits, email.lower(), _SEND_WINDOW, _SEND_MAX):
        return JSONResponse({"error": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}, status_code=429)
    left = _recover_cooldown_left(request.session.get('find_id_verify'), email, now)
    if left:
        return JSONResponse({"error": f"잠시 후 다시 시도해주세요. ({left}초)"}, status_code=429)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM members WHERE name = %s AND email = %s", (name, email))
            matched = cursor.fetchone() is not None
    finally:
        conn.close()

    if not matched:
        # 다른 이메일로 재시도했을 수 있으니 이전 대기 코드는 정리한다.
        request.session.pop('find_id_verify', None)
        return JSONResponse({"error": "입력하신 정보와 일치하는 계정이 없습니다."}, status_code=404)

    try:
        await run_in_threadpool(
            _recover_store_and_mail, request, 'find_id_verify', email,
            "[AI 가계부] 아이디 찾기 인증 코드", "아이디 찾기", {'name': name},
        )
    except Exception:
        logger.exception("아이디 찾기 메일 발송 실패")
        return JSONResponse({"error": "메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요."}, status_code=502)

    _hits_record(_send_hits, email.lower())
    return JSONResponse({"message": "인증 코드를 보냈습니다. 메일함을 확인해주세요."})


@router.post('/find-id/verify')
async def find_id_verify(request: Request):
    """발송한 코드를 검증하고, 통과하면 이름+이메일에 해당하는 아이디를 돌려준다."""
    data = await request.json()
    name  = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip()
    code  = (data.get('code') or '').strip()

    pending, err = _recover_check_code(request, 'find_id_verify', email, code)
    if err:
        return err
    # 코드 발송 때 확정한 이름과도 일치해야 한다(같은 이메일·다른 이름으로 우회 방지).
    if (pending.get('name') or '').strip() != name:
        return JSONResponse({"error": "인증 코드를 먼저 요청해주세요."}, status_code=400)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT user_id, created_at FROM members WHERE name = %s AND email = %s",
                (name, email),
            )
            row = cursor.fetchone()
    finally:
        conn.close()
    if not row:
        return JSONResponse({"error": "계정을 찾을 수 없습니다."}, status_code=404)

    created = row['created_at']
    return {
        "user_id": row['user_id'],
        "created_at": created.strftime('%Y-%m-%d') if created else None,
    }


@router.post('/reset-password/send-code')
async def reset_password_send_code(request: Request):
    """비밀번호 찾기 — 아이디+이메일이 일치하는 계정의 이메일로 인증 코드를 보낸다."""
    data = await request.json()
    user_id = (data.get('user_id') or '').strip()
    email   = (data.get('email') or '').strip()
    if not user_id or not email or not _EMAIL_RE.match(email):
        return JSONResponse({"error": "아이디와 이메일을 정확히 입력해주세요."}, status_code=400)
    if len(email) > 100:
        return JSONResponse({"error": "이메일이 너무 깁니다."}, status_code=400)

    now = time.time()
    if _hits_blocked(_send_hits, email.lower(), _SEND_WINDOW, _SEND_MAX):
        return JSONResponse({"error": "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."}, status_code=429)
    left = _recover_cooldown_left(request.session.get('pw_reset_verify'), email, now)
    if left:
        return JSONResponse({"error": f"잠시 후 다시 시도해주세요. ({left}초)"}, status_code=429)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM members WHERE user_id = %s AND email = %s",
                (user_id, email),
            )
            row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        request.session.pop('pw_reset_verify', None)
        request.session.pop('pw_reset_ok', None)
        return JSONResponse({"error": "입력하신 정보와 일치하는 계정이 없습니다."}, status_code=404)

    # 새 코드를 보냈으니 이전 검증완료 표시는 무효화한다.
    request.session.pop('pw_reset_ok', None)
    try:
        await run_in_threadpool(
            _recover_store_and_mail, request, 'pw_reset_verify', email,
            "[AI 가계부] 비밀번호 재설정 인증 코드", "비밀번호 찾기",
            {'member_id': row['id'], 'user_id': user_id},
        )
    except Exception:
        logger.exception("비밀번호 찾기 메일 발송 실패")
        return JSONResponse({"error": "메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요."}, status_code=502)

    _hits_record(_send_hits, email.lower())
    return JSONResponse({"message": "인증 코드를 보냈습니다. 메일함을 확인해주세요."})


@router.post('/reset-password/verify')
async def reset_password_verify(request: Request):
    """코드를 검증하고, 통과하면 새 비밀번호 설정을 허용하는 표시를 세션에 남긴다."""
    data = await request.json()
    user_id = (data.get('user_id') or '').strip()
    email   = (data.get('email') or '').strip()
    code    = (data.get('code') or '').strip()

    pending, err = _recover_check_code(request, 'pw_reset_verify', email, code)
    if err:
        return err
    if (pending.get('user_id') or '').strip() != user_id:
        return JSONResponse({"error": "인증 코드를 먼저 요청해주세요."}, status_code=400)

    # 코드 검증에 성공한 회원만 잠깐 동안 새 비밀번호를 설정할 수 있게 한다. 실제 변경 권한은
    # 이 표시뿐이며, member_id 는 코드를 통과한 뒤에만 여기로 넘어온다.
    request.session['pw_reset_ok'] = {
        'member_id': pending['member_id'],
        'expires': time.time() + _PW_RESET_WINDOW,
    }
    return JSONResponse({"message": "이메일 인증이 완료되었습니다.", "verified": True})


@router.post('/reset-password/confirm')
async def reset_password_confirm(request: Request):
    """코드 검증을 통과한 회원의 비밀번호를 새 값으로 바꾼다."""
    data = await request.json()
    new_pw = data.get('new_password') or ''

    ok = request.session.get('pw_reset_ok')
    if not ok or time.time() > ok.get('expires', 0):
        request.session.pop('pw_reset_ok', None)
        return JSONResponse({"error": "이메일 인증을 먼저 완료해주세요."}, status_code=400)

    # 가입·비밀번호 변경과 같은 규칙을 쓴다 — 여기만 느슨하면 규칙이 무의미해진다.
    pw_error = _password_error(new_pw)
    if pw_error:
        return JSONResponse({"error": pw_error}, status_code=400)

    member_id = ok['member_id']
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password_hash FROM members WHERE id = %s", (member_id,))
            row = cursor.fetchone()
            if not row:
                request.session.pop('pw_reset_ok', None)
                return JSONResponse({"error": "계정을 찾을 수 없습니다."}, status_code=404)
            # 소셜 전용(password_hash NULL)은 user_id 매칭 탓에 구조상 여기 못 오지만, 가드가
            # 그 추론을 다시 하는 것보다 싸다.
            if row['password_hash'] and check_password_hash(row['password_hash'], new_pw):
                return JSONResponse({"error": "이전과 다른 비밀번호를 입력하세요."}, status_code=400)
            cursor.execute(
                "UPDATE members SET password_hash = %s WHERE id = %s",
                (generate_password_hash(new_pw), member_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        logger.exception("비밀번호 재설정 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()

    request.session.pop('pw_reset_ok', None)
    return JSONResponse({"message": "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요."})


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
            # 소셜 전용 회원은 password_hash 가 NULL — check_password_hash 가 예외를 내면
            # 500/401 이 갈려 "이 아이디는 소셜 전용"을 알려주는 오라클이 된다. 401 로 통일.
            if user and user['password_hash'] and check_password_hash(user['password_hash'], password):
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
                # user_id 가 falsy 면 기록하지 않는다 — _login_blocked 의 정리는 `if user_id`
                # 안에서만 돌아, falsy 키(_login_fails[None]/[''])는 정리되지 않고 누적된다.
                if user_id:
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


@router.get('/profile')
async def profile(request: Request, _=Depends(api_require_login)):
    """마이페이지용 계정 정보. /me 와 달리 DB 에서 읽는다.

    /me 는 세션만 읽는 인증 가드용이고 화면 이동마다 호출된다 — 거기에 DB 조회를
    붙이면 이메일·핸드폰 때문에 모든 페이지가 쿼리를 한 번씩 더 낸다.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            user_no = get_user_no(request)
            cursor.execute(
                "SELECT user_id, name, email, phone, password_hash IS NOT NULL AS has_password "
                "FROM members WHERE id = %s",
                (user_no,),
            )
            row = cursor.fetchone()
            if not row:
                return JSONResponse({"error": "사용자를 찾을 수 없습니다."}, status_code=404)
            # 마이페이지의 소셜 연결 관리 + 소셜 전용 계정의 비밀번호 섹션 숨김에 쓴다.
            cursor.execute(
                "SELECT provider FROM member_social_accounts WHERE member_id = %s ORDER BY provider",
                (user_no,),
            )
            row['has_password'] = bool(row['has_password'])
            row['social'] = [r['provider'] for r in cursor.fetchall()]
        return row
    finally:
        conn.close()


@router.post('/update-phone')
async def update_phone(request: Request, _=Depends(api_require_login)):
    """마이페이지에서 핸드폰을 등록·수정한다. 빈 값이면 등록 해제(NULL).

    형식은 회원가입과 같은 _PHONE_RE(E.164)로 강제한다 — 정규화는 프론트가 하고
    여기선 최종 형태만 본다. members.phone 은 varchar(20).
    """
    data = await request.json()
    phone = (data.get('phone') or '').strip()
    if phone and not _PHONE_RE.match(phone):
        return JSONResponse({"error": "핸드폰 번호 형식이 올바르지 않습니다."}, status_code=400)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE members SET phone = %s WHERE id = %s",
                (phone or None, get_user_no(request)),
            )
        conn.commit()
        return {"message": "핸드폰 번호가 저장되었습니다.", "phone": phone or None}
    finally:
        conn.close()


@router.post('/change-password')
async def change_password(request: Request, _=Depends(api_require_login)):
    """현재 비밀번호를 확인한 뒤 새 비밀번호로 바꾼다.

    세션은 유지한다. 비밀번호를 바꿨다고 로그아웃시키면 사용자는 방금 정한 것을
    다시 입력해야 한다 — 세션 쿠키는 서명 기반이라 해시가 바뀌어도 유효하다.
    """
    data = await request.json()
    current = data.get('current_password') or ''
    new_pw = data.get('new_password') or ''

    user_no = get_user_no(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password_hash FROM members WHERE id = %s", (user_no,))
            row = cursor.fetchone()
            if not row:
                return JSONResponse({"error": "사용자를 찾을 수 없습니다."}, status_code=404)
            if row['password_hash'] is None:
                return JSONResponse({"error": "소셜 로그인 계정에는 비밀번호가 없습니다."}, status_code=400)
            # 현재 비밀번호를 먼저 확인한다. 세션만으로 바꾸게 두면 자리를 비운 사이
            # 남이 계정을 통째로 가져간다.
            if not check_password_hash(row['password_hash'], current):
                return JSONResponse({"error": "현재 비밀번호가 일치하지 않습니다."}, status_code=400)

            # 가입과 같은 규칙을 쓴다 — 여기만 느슨하면 가입 규칙이 무의미해진다.
            pw_error = _password_error(new_pw)
            if pw_error:
                return JSONResponse({"error": pw_error}, status_code=400)
            if new_pw == current:
                return JSONResponse({"error": "현재 비밀번호와 다른 비밀번호를 입력하세요."}, status_code=400)

            cursor.execute(
                "UPDATE members SET password_hash = %s WHERE id = %s",
                (generate_password_hash(new_pw), user_no),
            )
        conn.commit()
        return {"message": "비밀번호가 변경되었습니다."}
    finally:
        conn.close()


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
