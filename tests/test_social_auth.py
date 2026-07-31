"""소셜 로그인 통합 테스트 — 실 MySQL + TestClient.

외부 프로바이더 호출은 routes.social_auth._fetch_profile(격리 지점)을 대체해 목킹한다.
공격자 관점(state 위조·리플레이·프로바이더 교차·동의 우회·자동 링킹 차단)을 우선 검증한다.
"""
import json
import uuid
from base64 import b64decode, b64encode
from urllib.parse import parse_qs, urlparse

import itsdangerous
import pytest
from starlette.testclient import TestClient
from werkzeug.security import generate_password_hash

from app import app
from config import Config
from database.db_connection import get_db_connection
from routes import social_auth


# ──────────────────────────────────────────────────────────────────
# 픽스처·헬퍼
# ──────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def social_cfg(monkeypatch):
    """구글·카카오를 설정된 상태로 만든다(네이버는 미설정 유지)."""
    monkeypatch.setattr(Config, 'APP_BASE_URL', 'http://testserver')
    monkeypatch.setattr(Config, 'GOOGLE_CLIENT_ID', 'gid')
    monkeypatch.setattr(Config, 'GOOGLE_CLIENT_SECRET', 'gsecret')
    monkeypatch.setattr(Config, 'KAKAO_CLIENT_ID', 'kid')
    monkeypatch.setattr(Config, 'KAKAO_CLIENT_SECRET', 'ksecret')
    monkeypatch.setattr(Config, 'NAVER_CLIENT_ID', '')
    monkeypatch.setattr(Config, 'NAVER_CLIENT_SECRET', '')


@pytest.fixture(scope="module")
def cleanup():
    """테스트가 만든 회원 id 모음 — teardown 에서 가구·데이터까지 삭제."""
    ids = []
    yield ids
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            for member_id in ids:
                cur.execute(
                    "SELECT account_book_id FROM account_book_members WHERE member_id = %s",
                    (member_id,),
                )
                for row in cur.fetchall():
                    book_id = row['account_book_id']
                    cur.execute("DELETE FROM transactions WHERE account_book_id = %s", (book_id,))
                    cur.execute("DELETE FROM categories WHERE account_book_id = %s", (book_id,))
                    cur.execute("DELETE FROM settings WHERE account_book_id = %s", (book_id,))
                    cur.execute("DELETE FROM account_book_members WHERE account_book_id = %s", (book_id,))
                    cur.execute("DELETE FROM account_books WHERE id = %s", (book_id,))
                # member_consents·member_social_accounts 는 FK CASCADE 로 함께 지워진다.
                cur.execute("DELETE FROM members WHERE id = %s", (member_id,))
        conn.commit()
    finally:
        conn.close()


def _google_payload(sub, email=None, verified=True, name='구글러'):
    p = {'sub': sub, 'name': name}
    if email:
        p['email'] = email
        p['email_verified'] = verified
    return p


def _kakao_payload(kakao_id, email=None, name='카카오러'):
    account = {'profile': {'nickname': name}}
    if email:
        account.update({'email': email, 'is_email_valid': True, 'is_email_verified': True})
    return {'id': kakao_id, 'kakao_account': account}


def _mock_profile(monkeypatch, payload):
    async def fake(cfg, code, verifier):
        return payload
    monkeypatch.setattr(social_auth, '_fetch_profile', fake)


def _start(client, provider='google'):
    """start 를 호출해 (state, authorize URL) 를 얻는다. oauth_tx 쿠키는 클라이언트에 남는다."""
    r = client.get(f'/auth/social/{provider}/start', follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers['location']).query)
    return q['state'][0], r.headers['location']


def _callback(client, provider='google', state=None, code='authcode'):
    return client.get(
        f'/auth/social/{provider}/callback',
        params={'code': code, 'state': state},
        follow_redirects=False,
    )


def _session_update(client, **extra):
    """현재 세션 쿠키를 디코드해 값을 추가한 뒤 다시 서명한다(SessionMiddleware 와 동일 방식)."""
    payload = {}
    raw = client.cookies.get('session')
    if raw:
        seg = raw.split('.')[0]
        payload = json.loads(b64decode(seg + '=' * (-len(seg) % 4)))
    payload.update(extra)
    signer = itsdangerous.TimestampSigner(str(Config.SECRET_KEY))
    # httpx jar 는 서버 발급 쿠키를 'testserver.local' 도메인으로 따로 저장한다. 여기서 심는
    # 수동 쿠키(도메인 '')가 요청에서 이기지만, 서버가 세션을 갱신한 뒤에도 계속 이기므로
    # 서버 응답 세션을 다시 믿어야 하는 시점에 _drop_manual_session() 으로 지워야 한다.
    client.cookies.set('session', signer.sign(b64encode(json.dumps(payload).encode())).decode())


def _drop_manual_session(client):
    client.cookies.delete('session', domain='')


def _signup_via_google(client, monkeypatch, cleanup, email=None, sub=None):
    """start→callback→complete 정상 가입을 수행하고 member_id 를 반환한다."""
    sub = sub or 'sub_' + uuid.uuid4().hex[:12]
    email = email or f"{uuid.uuid4().hex[:10]}@gtest.com"
    _mock_profile(monkeypatch, _google_payload(sub, email))
    state, _ = _start(client, 'google')
    r = _callback(client, 'google', state)
    assert r.status_code == 302 and r.headers['location'] == '/register/social', r.headers
    r = client.post('/auth/social/complete',
                    json={'terms_agreed': True, 'privacy_agreed': True})
    assert r.status_code == 201, r.text
    member_id = client.get('/auth/me').json()['user_no']
    cleanup.append(member_id)
    return member_id, sub, email


def _insert_password_member(cleanup, email=None):
    """비밀번호 회원을 DB 직접 생성(가입 플로우 생략). (member_id, user_id, email) 반환."""
    uid = 'pysoc_' + uuid.uuid4().hex[:8]
    email = email or f"{uid}@ptest.com"
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO members (user_id, password_hash, name, email) VALUES (%s, %s, %s, %s)",
                (uid, generate_password_hash('Test1234!'), '패스워드유저', email),
            )
            member_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()
    cleanup.append(member_id)
    return member_id, uid, email


# ──────────────────────────────────────────────────────────────────
# 설정·시작
# ──────────────────────────────────────────────────────────────────
def test_providers_lists_only_configured():
    r = TestClient(app).get('/auth/social/providers')
    assert r.json() == {"providers": ["google", "kakao"]}  # 네이버 미설정 → 미노출


def test_providers_empty_without_base_url(monkeypatch):
    monkeypatch.setattr(Config, 'APP_BASE_URL', '')
    r = TestClient(app).get('/auth/social/providers')
    assert r.json() == {"providers": []}


def test_start_disabled_provider_redirects():
    r = TestClient(app).get('/auth/social/naver/start', follow_redirects=False)
    assert r.status_code == 302
    assert r.headers['location'] == '/login?social_error=disabled'


def test_start_sets_tx_cookie_and_pkce():
    c = TestClient(app)
    state, loc = _start(c, 'google')
    q = parse_qs(urlparse(loc).query)
    assert loc.startswith('https://accounts.google.com/')
    assert q['code_challenge_method'] == ['S256']
    assert q['redirect_uri'] == ['http://testserver/auth/social/google/callback']
    assert c.cookies.get('oauth_tx')


# ──────────────────────────────────────────────────────────────────
# 콜백 공격 표면
# ──────────────────────────────────────────────────────────────────
def test_callback_without_tx_cookie_fails(monkeypatch):
    _mock_profile(monkeypatch, _google_payload('s1', 'a@b.com'))
    c = TestClient(app)  # start 를 거치지 않음 — 북마크·직접 접근
    r = _callback(c, 'google', state='whatever')
    assert r.headers['location'] == '/login?social_error=state'
    assert 'session' not in r.cookies  # 세션 미발급


def test_callback_wrong_state_fails(monkeypatch):
    _mock_profile(monkeypatch, _google_payload('s2', 'a@b.com'))
    c = TestClient(app)
    _start(c, 'google')
    r = _callback(c, 'google', state='attacker-forged-state')  # 로그인 CSRF
    assert r.headers['location'] == '/login?social_error=state'


def test_callback_cross_provider_fails(monkeypatch):
    _mock_profile(monkeypatch, _kakao_payload(999))
    c = TestClient(app)
    state, _ = _start(c, 'google')          # 구글로 시작한 tx 를
    r = _callback(c, 'kakao', state=state)  # 카카오 콜백에 제출
    assert r.headers['location'] == '/login?social_error=state'


def test_callback_tampered_tx_cookie_fails(monkeypatch):
    _mock_profile(monkeypatch, _google_payload('s3', 'a@b.com'))
    c = TestClient(app)
    state, _ = _start(c, 'google')
    forged = itsdangerous.URLSafeTimedSerializer('x' * 32, salt='social-oauth-tx').dumps(
        {'s': state, 'p': 'google', 'v': 'v'})
    c.cookies.set('oauth_tx', forged, path='/auth/social')
    r = _callback(c, 'google', state=state)
    assert r.headers['location'] == '/login?social_error=state'


def test_callback_replay_fails_after_success(monkeypatch, cleanup):
    c = TestClient(app)
    member_id, sub, email = _signup_via_google(c, monkeypatch, cleanup)
    # 성공한 콜백에서 oauth_tx 가 삭제됐으므로 같은 code/state 재생은 state 단계에서 죽는다.
    r = _callback(c, 'google', state='replayed')
    assert r.headers['location'] == '/login?social_error=state'


def test_callback_user_denied():
    c = TestClient(app)
    _start(c, 'google')
    r = c.get('/auth/social/google/callback', params={'error': 'access_denied'},
              follow_redirects=False)
    assert r.headers['location'] == '/login?social_error=denied'


# ──────────────────────────────────────────────────────────────────
# 가입 (동의·이메일)
# ──────────────────────────────────────────────────────────────────
def test_signup_and_login_roundtrip(monkeypatch, cleanup):
    c = TestClient(app)
    member_id, sub, email = _signup_via_google(c, monkeypatch, cleanup)
    me = c.get('/auth/me').json()
    assert me['user_no'] == member_id and me['user_id'] is None
    # 같은 소셜 신원으로 재로그인 → 기존 회원 세션
    c2 = TestClient(app)
    _mock_profile(monkeypatch, _google_payload(sub, email))
    state, _ = _start(c2, 'google')
    r = _callback(c2, 'google', state)
    assert r.headers['location'] == '/record'
    assert c2.get('/auth/me').json()['user_no'] == member_id
    # 동의 이력이 가입 트랜잭션에 남았는지
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM member_consents WHERE member_id = %s", (member_id,))
        assert cur.fetchone()['cnt'] == 2
    conn.close()


def test_complete_without_pending_fails():
    r = TestClient(app).post('/auth/social/complete',
                             json={'terms_agreed': True, 'privacy_agreed': True})
    assert r.status_code == 400


def test_complete_without_consent_creates_nothing(monkeypatch):
    sub = 'noconsent_' + uuid.uuid4().hex[:8]
    c = TestClient(app)
    _mock_profile(monkeypatch, _google_payload(sub, f"{sub}@x.com"))
    state, _ = _start(c, 'google')
    _callback(c, 'google', state)
    r = c.post('/auth/social/complete', json={'terms_agreed': True, 'privacy_agreed': False})
    assert r.status_code == 400
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM member_social_accounts WHERE provider_user_id = %s", (sub,))
        assert cur.fetchone() is None  # 회원·연결 미생성
    conn.close()


def test_expired_pending_rejected():
    c = TestClient(app)
    _session_update(c, social_pending={
        'provider': 'google', 'provider_user_id': 'x', 'email': 'a@b.com',
        'provider_email': 'a@b.com', 'name': 'n', 'expires': 1.0,  # 과거
    })
    r = c.post('/auth/social/complete', json={'terms_agreed': True, 'privacy_agreed': True})
    assert r.status_code == 400


def test_kakao_without_email_requires_verification(monkeypatch, cleanup):
    kid = 700000000 + int(uuid.uuid4().hex[:6], 16)
    c = TestClient(app)
    _mock_profile(monkeypatch, _kakao_payload(kid))  # 이메일 미제공
    state, _ = _start(c, 'kakao')
    r = _callback(c, 'kakao', state)
    assert r.headers['location'] == '/register/social'
    assert c.get('/auth/social/pending').json()['needs_email'] is True
    # 이메일 인증 없이 완료 시도 → 400
    r = c.post('/auth/social/complete', json={'terms_agreed': True, 'privacy_agreed': True})
    assert r.status_code == 400
    # 기존 인증코드 플로우로 검증된 이메일을 세션에 심으면 통과
    email = f"{uuid.uuid4().hex[:10]}@ktest.com"
    _session_update(c, email_verified=email)
    r = c.post('/auth/social/complete', json={'terms_agreed': True, 'privacy_agreed': True})
    assert r.status_code == 201, r.text
    _drop_manual_session(c)  # 이후엔 서버가 발급한 로그인 세션을 읽어야 한다
    member_id = c.get('/auth/me').json()['user_no']
    cleanup.append(member_id)
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT email, user_id, password_hash FROM members WHERE id = %s", (member_id,))
        row = cur.fetchone()
        assert row['email'] == email and row['user_id'] is None and row['password_hash'] is None
        cur.execute(
            "SELECT provider_email FROM member_social_accounts WHERE member_id = %s", (member_id,))
        assert cur.fetchone()['provider_email'] is None  # 프로바이더가 안 준 이메일은 원본에도 없음
    conn.close()


def test_verified_email_conflict_no_auto_link(monkeypatch, cleanup):
    """기존 이메일 회원과 같은 검증 이메일의 소셜 가입 → 자동 병합 없이 email_taken."""
    _, _, email = _insert_password_member(cleanup)
    c = TestClient(app)
    _mock_profile(monkeypatch, _google_payload('conflict_' + uuid.uuid4().hex[:8], email))
    state, _ = _start(c, 'google')
    r = _callback(c, 'google', state)
    assert r.headers['location'] == '/login?social_error=email_taken'
    assert c.get('/auth/me').status_code == 401  # 세션 미발급, 병합 없음


# ──────────────────────────────────────────────────────────────────
# 연결(링크)·해제
# ──────────────────────────────────────────────────────────────────
def test_link_and_unlink(monkeypatch, cleanup):
    member_id, uid, _ = _insert_password_member(cleanup)
    c = TestClient(app)
    r = c.post('/auth/login', json={'user_id': uid, 'password': 'Test1234!'})
    assert r.status_code == 200
    sub = 'link_' + uuid.uuid4().hex[:8]
    _mock_profile(monkeypatch, _google_payload(sub, 'whatever@x.com'))
    r = c.get('/auth/social/google/link', follow_redirects=False)
    assert r.status_code == 302
    state = parse_qs(urlparse(r.headers['location']).query)['state'][0]
    r = _callback(c, 'google', state)
    assert r.headers['location'] == '/my?social=linked'
    assert c.get('/auth/profile').json()['social'] == ['google']
    # 타 회원이 같은 소셜 신원을 자기 계정에 연결 시도 → 충돌
    member2, uid2, _ = _insert_password_member(cleanup)
    c2 = TestClient(app)
    c2.post('/auth/login', json={'user_id': uid2, 'password': 'Test1234!'})
    _mock_profile(monkeypatch, _google_payload(sub, 'whatever@x.com'))
    r = c2.get('/auth/social/google/link', follow_redirects=False)
    state2 = parse_qs(urlparse(r.headers['location']).query)['state'][0]
    r = _callback(c2, 'google', state2)
    assert r.headers['location'] == '/my?social_error=link_conflict'
    # 비밀번호가 있는 회원의 해제는 허용
    r = c.request('DELETE', '/auth/social/google')
    assert r.status_code == 200
    assert c.get('/auth/profile').json()['social'] == []


def test_logout_clears_oauth_tx():
    """링크 권한을 담은 oauth_tx 는 로그아웃과 함께 죽어야 한다 — 공용 PC 에서 로그아웃 후
    타인이 남은 tx 로 피해자 계정에 자기 소셜을 연결하는 시나리오 차단(보안 리뷰 Medium)."""
    c = TestClient(app)
    _start(c, 'google')
    assert c.cookies.get('oauth_tx')
    c.post('/auth/logout')
    assert c.cookies.get('oauth_tx') is None


def test_unlink_last_method_blocked(monkeypatch, cleanup):
    c = TestClient(app)
    _signup_via_google(c, monkeypatch, cleanup)  # 소셜 전용(비밀번호 없음)
    r = c.request('DELETE', '/auth/social/google')
    assert r.status_code == 400
    assert '마지막 로그인 수단' in r.json()['error']
    assert c.get('/auth/profile').json()['social'] == ['google']  # 연결 유지


# ──────────────────────────────────────────────────────────────────
# 기존 인증 경로와의 정합
# ──────────────────────────────────────────────────────────────────
def test_social_only_member_password_flows_are_safe(monkeypatch, cleanup):
    c = TestClient(app)
    _signup_via_google(c, monkeypatch, cleanup)
    # 비밀번호 변경 → 500 이 아니라 400
    r = c.post('/auth/change-password',
               json={'current_password': 'x', 'new_password': 'Test1234!'})
    assert r.status_code == 400
    assert '소셜' in r.json()['error']
    # 프로필이 소셜 전용임을 알려준다(마이페이지 분기용)
    p = c.get('/auth/profile').json()
    assert p['has_password'] is False and p['user_id'] is None


def test_register_email_dup_with_social_member(monkeypatch, cleanup):
    """소셜 전용 회원(user_id NULL)의 이메일로 일반 가입 시도 → 500 크래시 없이 409."""
    c = TestClient(app)
    _, _, email = _signup_via_google(c, monkeypatch, cleanup)
    fresh = TestClient(app)
    signer = itsdangerous.TimestampSigner(str(Config.SECRET_KEY))
    fresh.cookies.set('session', signer.sign(
        b64encode(json.dumps({'email_verified': email}).encode())).decode())
    r = fresh.post('/auth/register', json={
        'user_id': 'dup_' + uuid.uuid4().hex[:8], 'password': 'Test1234!',
        'name': '중복시도', 'email': email,
        'terms_agreed': True, 'privacy_agreed': True,
    })
    assert r.status_code == 409
    assert '이메일' in r.json()['error']
