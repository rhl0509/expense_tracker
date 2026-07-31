"""소셜 로그인 (구글·카카오 — 네이버는 _PROVIDERS 항목 + 파싱 함수 추가로 확장).

플로우: 서버 주도 authorization code + PKCE(S256). 클라이언트가 준 토큰은 절대 받지
않고 서버가 직접 code 를 교환해 userinfo 를 조회한다 — ID 토큰(JWT)은 파싱하지 않는다.
토큰 엔드포인트와의 TLS 직통 수신이 서명 검증을 대신한다(OIDC Core 3.1.3.7). JWT 를
안 만지므로 JWKS·alg 혼동·nonce 가 전부 필요 없어진다.

세션 쿠키는 SameSite=Strict 라(app.py) 프로바이더에서 돌아오는 콜백 내비게이션에는
붙지 않는다. 그래서 start→callback 사이 상태(state·PKCE verifier)는 세션이 아니라
전용 서명 쿠키(oauth_tx, SameSite=Lax, Path=/auth/social, 10분 일회용)로 나른다 —
콜백 핸들러는 세션 쿠키를 읽지 않는다(무상태). 콜백이 세션에 "쓰는" 것은 가능하다:
Set-Cookie 는 우리 오리진의 최상위 내비게이션 응답이라 브라우저가 저장한다.

신원 키는 (provider, provider_user_id) 하나다. 이메일은 신원 키가 아니며, 이메일이
같다는 이유의 자동 링킹은 어떤 조건에서도 하지 않는다(미검증 이메일로 기존 계정을
접수하는 고전 벡터 차단). 기존 회원과의 연결은 로그인 후 마이페이지에서 수동으로만.

access/refresh 토큰은 저장하지 않는다 — 이 앱은 프로바이더 API 를 재호출할 일이
없다(AI 는 BYOK, 카드는 IMAP). refresh 토큰은 애초에 요청하지 않는다.
"""

import base64
import hashlib
import hmac
import logging
import secrets
import time
from urllib.parse import urlencode

import httpx
import pymysql
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer

from config import Config
from database.db_connection import get_db_connection
from routes.auth import PRIVACY_VERSION, TERMS_VERSION, _create_book_for_member
from routes.utils import api_require_login, get_default_book_id, get_user_no

router = APIRouter()
logger = logging.getLogger(__name__)

_TX_COOKIE = 'oauth_tx'
_TX_MAX_AGE = 600       # start→callback 허용 시간(초) = 10분
_PENDING_TTL = 900      # 콜백→가입 완료(동의·이메일 인증) 허용 시간(초) = 15분
_LINK_COOKIE = 'link_tx'
_LINK_MAX_AGE = 600     # 콜백→연결 확인 허용 시간(초) = 10분

# 세션과 다른 salt — 세션 쿠키를 oauth_tx 로 재사용하는 교차를 서명 수준에서 막는다.
# link_tx 도 salt 를 분리해 oauth_tx 를 연결 승인 티켓으로 되돌려쓰지 못하게 한다.
_signer = URLSafeTimedSerializer(Config.SECRET_KEY, salt='social-oauth-tx')
_link_signer = URLSafeTimedSerializer(Config.SECRET_KEY, salt='social-link-tx')


def _parse_google(payload: dict) -> tuple[str | None, str | None, bool, str | None]:
    """openidconnect userinfo → (provider_user_id, email, email_verified, name)."""
    sub = payload.get('sub')
    email = (payload.get('email') or '').strip() or None
    return (
        str(sub) if sub else None,
        email,
        bool(email) and payload.get('email_verified') is True,
        (payload.get('name') or '').strip() or None,
    )


def _parse_kakao(payload: dict) -> tuple[str | None, str | None, bool, str | None]:
    """kapi /v2/user/me → 동일 튜플. 이메일은 동의항목 미승인·미동의로 없을 수 있다."""
    account = payload.get('kakao_account') or {}
    profile = account.get('profile') or {}
    kakao_id = payload.get('id')
    email = (account.get('email') or '').strip() or None
    verified = (
        bool(email)
        and account.get('is_email_valid') is True
        and account.get('is_email_verified') is True
    )
    return (
        str(kakao_id) if kakao_id is not None else None,
        email,
        verified,
        (profile.get('nickname') or '').strip() or None,
    )


# 프로바이더 추가 = 여기 항목 1개 + _parse_* 함수 1개. 핸들러는 provider 를 문자열로만
# 다루고 분기하지 않는다. 네이버(후속): authorize/token nid.naver.com/oauth2.0/*,
# userinfo openapi.naver.com/v1/nid/me — PKCE 지원 미확인이라 붙일 때 pkce 플래그로 결정.
_PROVIDERS = {
    'google': {
        'authorize': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token': 'https://oauth2.googleapis.com/token',
        'userinfo': 'https://openidconnect.googleapis.com/v1/userinfo',
        'scope': 'openid email profile',
        'pkce': True,
        'parse': _parse_google,
    },
    'kakao': {
        'authorize': 'https://kauth.kakao.com/oauth/authorize',
        'token': 'https://kauth.kakao.com/oauth/token',
        'userinfo': 'https://kapi.kakao.com/v2/user/me',
        # 카카오는 scope 를 보내지 않는다 — 동의항목은 콘솔에서 정하고, 여기서 요청한 항목이
        # 콘솔에서 '사용 안 함'/'권한 없음'이면 인가 단계에서 KOE205 로 거절당한다
        # (account_email 은 비즈 앱 전환 전까지 영구히 '권한 없음'이다). 생략하면 콘솔에
        # 설정된 항목으로 동의 화면이 뜨므로 콘솔 설정과 코드가 어긋날 일이 없다.
        'scope': '',
        'pkce': True,
        'parse': _parse_kakao,
    },
}


def _provider_config(provider: str) -> dict | None:
    """활성(설정 완료) 프로바이더의 실행 설정. 미설정·미지원이면 None — 경로 변수
    화이트리스트를 겸한다."""
    if provider not in _PROVIDERS or provider not in Config.social_providers():
        return None
    cfg = dict(_PROVIDERS[provider])
    upper = provider.upper()
    cfg['client_id'] = getattr(Config, f'{upper}_CLIENT_ID')
    cfg['client_secret'] = getattr(Config, f'{upper}_CLIENT_SECRET')
    cfg['redirect_uri'] = f"{Config.APP_BASE_URL}/auth/social/{provider}/callback"
    return cfg


def _redirect(path: str) -> RedirectResponse:
    """고정 상대 경로로만 리다이렉트한다. 복귀 경로를 쿼리로 받으면 인증 엔드포인트 옆의
    오픈 리다이렉트가 되므로 받지 않는다. oauth_tx 는 일회용이라 항상 지운다."""
    resp = RedirectResponse(path, status_code=302)
    resp.delete_cookie(_TX_COOKIE, path='/auth/social')
    return resp


@router.get('/social/providers')
async def social_providers():
    """설정된 프로바이더 목록. 로그인 페이지가 버튼 렌더에 쓴다."""
    return {"providers": list(Config.social_providers())}


def _begin_flow(provider: str, member_no: int | None) -> RedirectResponse:
    """인가 요청으로 302. state·PKCE verifier(·링크 모드면 회원번호)를 oauth_tx 서명
    쿠키에 담는다. member_no 는 로그인이 확인된 시점에 서명되므로 콜백에서 권위가 있다."""
    cfg = _provider_config(provider)
    if cfg is None:
        # 경로변수는 사용자 통제 문자열 — 화이트리스트 밖이면 원문을 로그에 넣지 않는다.
        logger.warning("소셜 시작: 미설정 프로바이더 호출 provider=%s",
                       provider if provider in _PROVIDERS else '<unknown>')
        return _redirect('/login?social_error=disabled')

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    tx = {'s': state, 'p': provider, 'v': verifier}
    if member_no is not None:
        tx['m'] = member_no

    params = {
        'client_id': cfg['client_id'],
        'redirect_uri': cfg['redirect_uri'],
        'response_type': 'code',
        'state': state,
    }
    if cfg['scope']:
        params['scope'] = cfg['scope']
    if member_no is not None:
        # 연결 모드에서만 계정 선택 화면을 강제한다. 브라우저에 프로바이더 세션이 있으면
        # 선택 없이 그대로 승인돼, 사용자는 자기 계정에 "어느 계정이 붙는지" 모른 채 확정하게
        # 된다. 연결은 새 로그인 수단을 영구히 부여하는 일이라 의식적으로 고르게 한다.
        # (로그인 모드는 잘못 골라도 로그아웃하면 그만이라 마찰을 더하지 않는다.)
        params['prompt'] = 'select_account'
    if cfg['pkce']:
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode('ascii')).digest()
        ).rstrip(b'=').decode('ascii')
        params['code_challenge'] = challenge
        params['code_challenge_method'] = 'S256'

    resp = RedirectResponse(f"{cfg['authorize']}?{urlencode(params)}", status_code=302)
    resp.set_cookie(
        _TX_COOKIE,
        _signer.dumps(tx),
        max_age=_TX_MAX_AGE,
        httponly=True,
        secure=Config.SESSION_COOKIE_SECURE,
        samesite='lax',       # Strict 면 프로바이더발 콜백에 안 붙는다. 세션과 달리 이 쿠키만 Lax.
        path='/auth/social',  # 콜백 외 경로에는 아예 전송되지 않게 스코프를 좁힌다.
    )
    return resp


@router.get('/social/{provider}/start')
async def social_start(provider: str):
    """비로그인 진입점 — 소셜 로그인/가입 시작."""
    return _begin_flow(provider, member_no=None)


@router.get('/social/{provider}/link')
async def social_link(provider: str, request: Request, _=Depends(api_require_login)):
    """로그인 필요 진입점 — 마이페이지에서 기존 계정에 소셜 연결 시작.
    start 와 합치지 않는다: 인증 요구가 달라 한 핸들러에 두 신뢰 수준을 섞지 않는다."""
    return _begin_flow(provider, member_no=get_user_no(request))


async def _fetch_profile(cfg: dict, code: str, verifier: str) -> dict:
    """code 를 토큰으로 교환하고 userinfo 를 조회해 원본 payload 를 반환한다.
    실패는 httpx 예외로 전파된다. 테스트가 이 함수를 통째로 대체한다(외부 호출 격리 지점)."""
    token_data = {
        'grant_type': 'authorization_code',
        'client_id': cfg['client_id'],
        'client_secret': cfg['client_secret'],
        'redirect_uri': cfg['redirect_uri'],
        'code': code,
    }
    if cfg['pkce']:
        token_data['code_verifier'] = verifier
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(cfg['token'], data=token_data)
        token_resp.raise_for_status()
        access_token = token_resp.json().get('access_token')
        if not access_token:
            raise httpx.HTTPError("token response missing access_token")
        info_resp = await client.get(
            cfg['userinfo'], headers={'Authorization': f'Bearer {access_token}'}
        )
        info_resp.raise_for_status()
        return info_resp.json()
        # access token 은 여기서 스코프를 벗어나 버려진다. 저장하지 않는다.


@router.get('/social/{provider}/callback')
async def social_callback(provider: str, request: Request):
    """프로바이더가 돌아오는 유일한 등록 redirect_uri. 세션 쿠키를 읽지 않는다 —
    입력은 쿼리스트링과 oauth_tx 서명 쿠키 두 곳뿐이다. 검증 실패 사유는 사용자에게
    구분해 알리지 않는다(전부 social_error=state)."""
    # 경로변수·쿼리는 사용자 통제 문자열이다 — 로그에는 화이트리스트 통과분/절단본만 쓴다
    # (개행 포함 임의 문자열을 그대로 찍으면 로그 라인 위조가 된다).
    safe_provider = provider if provider in _PROVIDERS else '<unknown>'

    # a. 사용자 거부·프로바이더 에러
    err_param = request.query_params.get('error')
    if err_param:
        logger.info("소셜 콜백 거부/에러 provider=%s error=%s",
                    safe_provider, err_param.replace('\n', ' ').replace('\r', ' ')[:32])
        return _redirect('/login?social_error=denied')

    # b~e. tx 쿠키(서명·TTL·프로바이더·state) 검증 — 하나라도 실패면 즉시 종료
    raw_tx = request.cookies.get(_TX_COOKIE)
    if not raw_tx:
        logger.warning("소셜 콜백: oauth_tx 쿠키 없음 provider=%s", safe_provider)
        return _redirect('/login?social_error=state')
    try:
        tx = _signer.loads(raw_tx, max_age=_TX_MAX_AGE)
    except BadSignature:
        logger.warning("소셜 콜백: oauth_tx 서명 불일치 또는 만료 provider=%s", safe_provider)
        return _redirect('/login?social_error=state')
    if tx.get('p') != provider:
        logger.warning("소셜 콜백: 프로바이더 교차 tx=%s path=%s", tx.get('p'), safe_provider)
        return _redirect('/login?social_error=state')
    state = request.query_params.get('state') or ''
    if not state or not hmac.compare_digest(tx.get('s', ''), state):
        logger.warning("소셜 콜백: state 불일치 provider=%s — 로그인 CSRF 시도 후보", safe_provider)
        return _redirect('/login?social_error=state')
    code = request.query_params.get('code') or ''
    if not code:
        return _redirect('/login?social_error=state')

    cfg = _provider_config(provider)
    if cfg is None:
        return _redirect('/login?social_error=disabled')

    # f~g. 토큰 교환 + userinfo (여기부터 tx 는 소모된 것으로 취급 — 응답이 무엇이든 쿠키 삭제)
    try:
        payload = await _fetch_profile(cfg, code, tx.get('v', ''))
    except (httpx.HTTPError, ValueError):
        # ValueError: 200 + 비JSON 응답(.json() 의 JSONDecodeError 포함) — WAF/프록시 HTML 등.
        # 응답 본문을 로그에 찍지 않는다 — 코드·시크릿이 에코될 수 있다.
        logger.error("소셜 토큰 교환/프로필 조회 실패 provider=%s", provider)
        return _redirect('/login?social_error=exchange')

    try:
        puid, email, email_verified, name = cfg['parse'](payload)
    except Exception:
        # 프로바이더가 dict 가 아닌·구조가 다른 페이로드를 줘도 500 + tx 잔류로 끝나지 않게.
        logger.error("소셜 프로필 파싱 실패 provider=%s", provider)
        return _redirect('/login?social_error=profile')
    if not puid:
        logger.error("소셜 프로필에 식별자 없음 provider=%s", provider)
        return _redirect('/login?social_error=profile')

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:  # DB 오류도 500 + tx 잔류 대신 안내 리다이렉트로 (아래 except)
            # ── 링크 모드: 로그인 상태에서 시작된 연결 ──
            if 'm' in tx:
                member_no = tx['m']
                cursor.execute(
                    "SELECT member_id FROM member_social_accounts "
                    "WHERE provider = %s AND provider_user_id = %s",
                    (provider, puid),
                )
                row = cursor.fetchone()
                if row:
                    if row['member_id'] == member_no:
                        return _redirect('/my?social=linked')  # 이미 연결됨 — 멱등
                    logger.warning("소셜 연결 충돌: 타 회원 소유 provider=%s", provider)
                    return _redirect('/my?social_error=link_conflict')
                # 여기서 바로 붙이지 않는다 — 연결은 새 로그인 수단을 영구히 부여하는 일이라,
                # 어느 소셜 계정이 붙는지 보고 승인하는 단계를 거친다(/social/link/confirm).
                # 대기 정보를 세션에 쓰면 안 된다: 콜백 요청에는 SameSite=Strict 세션 쿠키가
                # 실려오지 않아 빈 세션이 저장되고, 그 순간 사용자가 로그아웃된다. 그래서
                # oauth_tx 와 같은 방식의 전용 서명 쿠키로 나른다.
                resp = _redirect('/my?social_confirm=1')
                resp.set_cookie(
                    _LINK_COOKIE,
                    _link_signer.dumps({
                        'm': member_no, 'p': provider, 'u': puid, 'e': email, 'n': name,
                    }),
                    max_age=_LINK_MAX_AGE,
                    httponly=True,
                    secure=Config.SESSION_COOKIE_SECURE,
                    samesite='lax',
                    path='/auth/social',
                )
                return resp

            # ── 로그인 모드 ──
            cursor.execute(
                "SELECT msa.member_id, m.status, m.user_id, m.name "
                "FROM member_social_accounts msa "
                "JOIN members m ON m.id = msa.member_id "
                "WHERE msa.provider = %s AND msa.provider_user_id = %s",
                (provider, puid),
            )
            row = cursor.fetchone()
            if row:
                # 기존 소셜 회원 로그인
                if row['status'] != 'active':
                    logger.warning("소셜 로그인 거부: 비활성 계정 provider=%s", provider)
                    return _redirect('/login?social_error=inactive')
                cursor.execute(
                    "UPDATE member_social_accounts SET last_login_at = NOW() "
                    "WHERE provider = %s AND provider_user_id = %s",
                    (provider, puid),
                )
                member_no = row['member_id']
                book_id = get_default_book_id(cursor, member_no)
                if book_id is None:
                    book_id = _create_book_for_member(cursor, member_no, row['name'])
                conn.commit()
                # 신원 부여 전에 세션을 비운다 — 이전 신원의 복구 티켓·대기 상태가 남지 않게.
                request.session.clear()
                request.session['user_no'] = member_no
                request.session['user_id'] = row['user_id']       # 소셜 전용이면 None
                request.session['user_name'] = row['name']
                request.session['account_book_id'] = book_id
                return _redirect('/record')

            # 신규 — 검증된 이메일이 기존 회원과 겹치면 자동 병합하지 않고 수동 연결로 안내.
            # URL 에 이메일을 싣지 않는다.
            if email_verified and email:
                cursor.execute("SELECT id FROM members WHERE email = %s", (email,))
                if cursor.fetchone():
                    logger.info("소셜 신규: 검증 이메일이 기존 계정과 충돌 provider=%s", provider)
                    return _redirect('/login?social_error=email_taken')
    except Exception:
        conn.rollback()
        logger.exception("소셜 콜백 DB 처리 실패 provider=%s", provider)
        return _redirect('/login?social_error=exchange')
    finally:
        conn.close()

    # 가입 대기 티켓 — 동의(및 필요시 이메일 인증)를 거쳐 /auth/social/complete 가 소비한다.
    # 콜백 응답의 Set-Cookie 는 우리 오리진 최상위 내비게이션이라 Strict 세션에도 저장된다.
    request.session['social_pending'] = {
        'provider': provider,
        'provider_user_id': puid,
        'email': email if email_verified else None,  # 소유가 확인된 이메일만
        'provider_email': email,                     # 원본(참고용 저장 대상)
        'name': name,
        'expires': time.time() + _PENDING_TTL,
    }
    return _redirect('/register/social')


def _get_pending(request: Request) -> dict | None:
    pending = request.session.get('social_pending')
    if not pending or time.time() > pending.get('expires', 0):
        request.session.pop('social_pending', None)
        return None
    return pending


@router.get('/social/pending')
async def social_pending(request: Request):
    """가입 동의 화면(/register/social) 렌더용 — 대기 중인 소셜 가입 정보."""
    pending = _get_pending(request)
    if not pending:
        return JSONResponse({"error": "가입 시간이 초과되었습니다. 다시 시작해주세요."}, status_code=400)
    return {
        "provider": pending['provider'],
        "name": pending['name'],
        "email": pending['email'],
        "needs_email": pending['email'] is None,
    }


@router.post('/social/complete')
async def social_complete(request: Request):
    """동의 확정 → 회원 생성 → 세션 발급. register 와 같은 규율:
    프론트 체크박스를 믿지 않고 서버가 동의·이메일 인증을 재검증한다."""
    data = await request.json()
    pending = _get_pending(request)
    if not pending:
        return JSONResponse({"error": "가입 시간이 초과되었습니다. 다시 시작해주세요."}, status_code=400)
    if not (data.get('terms_agreed') is True and data.get('privacy_agreed') is True):
        return JSONResponse({"error": "이용약관과 개인정보처리방침에 동의해주세요."}, status_code=400)

    name = (data.get('name') or pending.get('name') or '').strip()
    if not name:
        return JSONResponse({"error": "이름을 입력해주세요."}, status_code=400)
    if len(name) > 50:
        return JSONResponse({"error": "이름이 너무 깁니다."}, status_code=400)

    email = pending['email']  # 프로바이더가 검증을 보장한 이메일
    if email is None:
        # 카카오 등 이메일 미제공 — 기존 인증코드 플로우(send/verify-email-code)로 확인된
        # 이메일을 요구한다. 이게 소셜 전용 회원의 유일한 복구 채널이 된다.
        email = (request.session.get('email_verified') or '').strip()
        if not email:
            return JSONResponse({"error": "이메일 인증을 완료해주세요."}, status_code=400)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # UNIQUE 제약이 최종 방어선이지만, 정상 경합은 여기서 사람 말로 걸러낸다.
            cursor.execute("SELECT id FROM members WHERE email = %s", (email,))
            if cursor.fetchone():
                return JSONResponse({"error": "이미 가입된 이메일입니다."}, status_code=409)
            cursor.execute(
                "INSERT INTO members (user_id, password_hash, name, email) "
                "VALUES (NULL, NULL, %s, %s)",
                (name, email),
            )
            new_member_id = cursor.lastrowid
            cursor.executemany(
                "INSERT INTO member_consents (member_id, doc, version) VALUES (%s, %s, %s)",
                [
                    (new_member_id, 'terms', TERMS_VERSION),
                    (new_member_id, 'privacy', PRIVACY_VERSION),
                ],
            )
            cursor.execute(
                "INSERT INTO member_social_accounts "
                "(member_id, provider, provider_user_id, provider_email, last_login_at) "
                "VALUES (%s, %s, %s, %s, NOW())",
                (new_member_id, pending['provider'], pending['provider_user_id'],
                 pending['provider_email']),
            )
            book_id = _create_book_for_member(cursor, new_member_id, name)
        conn.commit()
    except pymysql.err.IntegrityError:
        # 같은 소셜 신원의 동시 가입 경합(uq_provider_user) 등.
        conn.rollback()
        logger.warning("소셜 가입 UNIQUE 충돌 provider=%s", pending['provider'])
        return JSONResponse({"error": "이미 가입된 계정입니다. 다시 로그인해주세요."}, status_code=409)
    except Exception:
        conn.rollback()
        logger.exception("소셜 가입 실패")
        # pending 은 남겨 둔다 — 재시도하면 이어서 진행된다.
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()

    # 신원 부여 전에 세션을 통째로 비운다(pending·인증 흔적 정리 겸 이전 신원 잔여 키 제거).
    request.session.clear()
    request.session['user_no'] = new_member_id
    request.session['user_id'] = None
    request.session['user_name'] = name
    request.session['account_book_id'] = book_id
    return JSONResponse({"message": "가입이 완료되었습니다."}, status_code=201)


def _link_pending(request: Request) -> dict | None:
    """link_tx 쿠키를 읽어 승인 대기 중인 연결을 돌려준다. 서명·TTL 이 유효하고 **로그인한
    본인의 티켓일 때만** 유효로 본다 — 남의 브라우저에 남은 티켓을 다른 계정이 승인할 수 없다."""
    raw = request.cookies.get(_LINK_COOKIE)
    if not raw:
        return None
    try:
        pending = _link_signer.loads(raw, max_age=_LINK_MAX_AGE)
    except BadSignature:
        return None
    return pending if pending.get('m') == get_user_no(request) else None


def _clear_link(payload: dict, status_code: int = 200) -> JSONResponse:
    resp = JSONResponse(payload, status_code=status_code)
    resp.delete_cookie(_LINK_COOKIE, path='/auth/social')
    return resp


@router.get('/social/link/pending')
async def social_link_pending(request: Request, _=Depends(api_require_login)):
    """연결 확인 모달이 "어느 소셜 계정인지"를 보여주기 위해 읽는다."""
    pending = _link_pending(request)
    if not pending:
        return JSONResponse({"error": "연결 요청이 만료되었습니다. 다시 시도해주세요."}, status_code=400)
    return {"provider": pending['p'], "email": pending['e'], "name": pending['n']}


@router.post('/social/link/confirm')
async def social_link_confirm(request: Request, _=Depends(api_require_login)):
    """사용자가 승인한 시점에 실제로 연결한다."""
    pending = _link_pending(request)
    if not pending:
        return JSONResponse({"error": "연결 요청이 만료되었습니다. 다시 시도해주세요."}, status_code=400)

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO member_social_accounts "
                "(member_id, provider, provider_user_id, provider_email) "
                "VALUES (%s, %s, %s, %s)",
                (pending['m'], pending['p'], pending['u'], pending['e']),
            )
        conn.commit()
    except pymysql.err.IntegrityError:
        # uq_provider_user(그 사이 타 회원이 선점) 또는 uq_member_provider(같은 프로바이더 중복).
        conn.rollback()
        logger.warning("소셜 연결 실패(UNIQUE) provider=%s", pending['p'])
        return _clear_link({"error": "이미 연결된 계정입니다."}, status_code=409)
    finally:
        conn.close()
    return _clear_link({"message": "소셜 계정이 연결되었습니다."})


@router.post('/social/link/cancel')
async def social_link_cancel(request: Request, _=Depends(api_require_login)):
    """승인하지 않고 닫았을 때 티켓을 즉시 버린다(안 지우면 새로고침마다 다시 묻는다)."""
    return _clear_link({"message": "연결을 취소했습니다."})


@router.delete('/social/{provider}')
async def social_unlink(provider: str, request: Request, _=Depends(api_require_login)):
    """소셜 연결 해제. 마지막 로그인 수단이면 거부한다 — 계정을 스스로 영구 잠그는
    원클릭 버튼을 제공하지 않기 위해."""
    user_no = get_user_no(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT password_hash FROM members WHERE id = %s", (user_no,))
            member = cursor.fetchone()
            if not member:
                return JSONResponse({"error": "사용자를 찾을 수 없습니다."}, status_code=404)
            cursor.execute(
                "SELECT COUNT(*) AS cnt FROM member_social_accounts WHERE member_id = %s",
                (user_no,),
            )
            if member['password_hash'] is None and cursor.fetchone()['cnt'] <= 1:
                return JSONResponse({"error": "마지막 로그인 수단은 해제할 수 없습니다."}, status_code=400)
            cursor.execute(
                "DELETE FROM member_social_accounts WHERE member_id = %s AND provider = %s",
                (user_no, provider),
            )
            if cursor.rowcount == 0:
                return JSONResponse({"error": "연결되지 않은 프로바이더입니다."}, status_code=404)
        conn.commit()
        return {"message": "연결이 해제되었습니다."}
    finally:
        conn.close()
