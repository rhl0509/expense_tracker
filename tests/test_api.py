"""
백엔드 통합 테스트 — 실제 MySQL + FastAPI(TestClient)로 엔드포인트를 검증한다.

임시 테스트 유저를 생성/로그인하고, 테스트가 만든 데이터(거래·정기결제·카테고리)는
teardown에서 모두 삭제한다. 공유 자원(account_book=2의 settings)은 스냅샷 후 복원한다.
"""
import os
import uuid
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from app import app
from database.db_connection import get_db_connection

# 가입 비밀번호 규칙(대소문자·숫자·특수문자 포함 8자 이상)을 만족해야 register가 201을 준다.
TEST_PW = "Test1234!"


@pytest.fixture(scope="module")
def created():
    """teardown에서 정리할 리소스 id 모음."""
    return {"txn_ids": [], "recurring_ids": [], "category_ids": [], "member_id": None, "book_id": None}


@pytest.fixture(scope="module")
def client(created):
    c = TestClient(app)
    uid = "pytest_" + uuid.uuid4().hex[:8]

    # 1) 회원가입 (자동으로 전용 가구 + 기본 카테고리 생성됨)
    r = c.post("/auth/register", json={"user_id": uid, "password": TEST_PW, "name": "테스트유저", "email": f"{uid}@test.com"})
    assert r.status_code == 201, r.text

    # 2) 로그인 (세션 쿠키 저장됨)
    r = c.post("/auth/login", json={"user_id": uid, "password": TEST_PW})
    assert r.status_code == 200, r.text

    # member_id / 전용 가구 id 조회
    created["book_id"] = c.get("/auth/me").json()["account_book_id"]
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM members WHERE user_id = %s", (uid,))
        created["member_id"] = cur.fetchone()["id"]
    conn.close()

    yield c

    # ── teardown: 이 유저의 전용 가구와 그 하위 데이터를 모두 제거 ──
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            book_id = created["book_id"]
            cur.execute("DELETE FROM transactions WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM transactions WHERE member_id = %s", (created["member_id"],))
            cur.execute("DELETE FROM recurring_transactions WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM categories WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM settings WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_book_invites WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_book_members WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_books WHERE id = %s", (book_id,))
            cur.execute("DELETE FROM members WHERE id = %s", (created["member_id"],))
        conn.commit()
    finally:
        conn.close()


@pytest.fixture(scope="module")
def cat_id(client):
    """테스트 유저 가구의 지출 카테고리 id 하나."""
    cats = client.get("/transaction/categories").json()
    return next(c["id"] for c in cats if c["type"] == "expense")


# ──────────────────────────────────────────────────────────────────
# 인증
# ──────────────────────────────────────────────────────────────────
def test_me_requires_login():
    fresh = TestClient(app)
    assert fresh.get("/auth/me").status_code == 401


def test_me_after_login(client):
    r = client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["user_name"] == "테스트유저"


def test_health():
    fresh = TestClient(app)
    r = fresh.get("/health")
    assert r.status_code in (200, 503)
    body = r.json()
    assert "components" in body and body["components"]["db"]["ok"] is True


# ──────────────────────────────────────────────────────────────────
# 거래 CRUD
# ──────────────────────────────────────────────────────────────────
def test_transaction_add_list_delete(client, created, cat_id):
    r = client.post(
        "/transaction/add",
        json={"type": "expense", "category_id": cat_id, "amount": 15000, "description": "pytest 점심", "payment_method": "현금", "date": "2026-06-10"},
    )
    assert r.status_code == 201, r.text

    data = client.get("/transaction/data").json()
    assert any(t["title"] == "pytest 점심" and t["amount"] == 15000 for t in data)
    tx = next(t for t in data if t["title"] == "pytest 점심")
    created["txn_ids"].append(tx["id"])

    # 삭제
    r = client.delete(f"/transaction/delete/{tx['id']}")
    assert r.status_code == 200
    data2 = client.get("/transaction/data").json()
    assert all(t["id"] != tx["id"] for t in data2)


def test_summary_and_yearly(client):
    s = client.get("/transaction/summary").json()
    assert "income" in s and "expense" in s
    y = client.get("/transaction/yearly-summary").json()
    assert "income" in y and "expense" in y


def test_recent_and_list(client, created, cat_id):
    client.post("/transaction/add", json={"type": "income", "category_id": cat_id, "amount": 50000, "description": "pytest 수입", "date": "2026-06-09"})
    recent = client.get("/transaction/recent?limit=5").json()
    assert isinstance(recent, list) and len(recent) <= 5
    lst = client.get("/transaction/list?year=2026&month=6").json()
    assert isinstance(lst, list)
    assert any(t.get("title") == "pytest 수입" for t in lst)
    # date 별칭 필드 확인
    assert all("date" in t for t in lst)


# ──────────────────────────────────────────────────────────────────
# 카테고리
# ──────────────────────────────────────────────────────────────────
def test_categories_crud(client, created):
    cats = client.get("/transaction/categories").json()
    assert isinstance(cats, list) and len(cats) > 0

    r = client.post("/transaction/category/add", json={"name": "pytest카테고리", "type": "expense", "parent_id": None})
    assert r.status_code == 201

    cats2 = client.get("/transaction/categories").json()
    new_cat = next(c for c in cats2 if c["name"] == "pytest카테고리")
    created["category_ids"].append(new_cat["id"])

    # reorder (자기 자신 id 한 개만 전달 — 에러 없이 통과해야 함)
    r = client.post("/transaction/category/reorder", json={"type": "expense", "ids": [new_cat["id"]]})
    assert r.status_code == 200

    r = client.delete(f"/transaction/category/delete/{new_cat['id']}")
    assert r.status_code == 200


# ──────────────────────────────────────────────────────────────────
# 설정 (user-labels / payment-methods)
# ──────────────────────────────────────────────────────────────────
def test_user_labels(client):
    labels = client.get("/transaction/settings/user-labels").json()
    assert isinstance(labels, list) and len(labels) >= 1

    r = client.post("/transaction/settings/user-labels", json={"labels": ["공용", "테스트A", "테스트B"]})
    assert r.status_code == 200
    again = client.get("/transaction/settings/user-labels").json()
    assert again == ["공용", "테스트A", "테스트B"]

    # 빈 배열은 거부
    assert client.post("/transaction/settings/user-labels", json={"labels": []}).status_code == 400


def test_payment_methods(client):
    methods = client.get("/transaction/settings/payment-methods").json()
    assert isinstance(methods, list)
    r = client.post("/transaction/settings/payment-methods", json={"methods": ["현금", "카드"]})
    assert r.status_code == 200
    assert client.get("/transaction/settings/payment-methods").json() == ["현금", "카드"]


# ──────────────────────────────────────────────────────────────────
# 정기 결제
# ──────────────────────────────────────────────────────────────────
def test_recurring(client, created, cat_id):
    r = client.post(
        "/transaction/recurring/add",
        json={"category_id": cat_id, "title": "pytest구독", "type": "expense", "repeat_day": 15, "user": "공용", "amount": 9900},
    )
    assert r.status_code == 201
    lst = client.get("/transaction/recurring/list").json()
    item = next((x for x in lst if x["title"] == "pytest구독"), None)
    assert item is not None
    created["recurring_ids"].append(item["id"])
    assert client.delete(f"/transaction/recurring/delete/{item['id']}").status_code == 200


# ──────────────────────────────────────────────────────────────────
# 초기화
# ──────────────────────────────────────────────────────────────────
def test_reset(client, cat_id):
    client.post("/transaction/add", json={"type": "expense", "category_id": cat_id, "amount": 1000, "description": "리셋대상", "date": "2026-06-01"})
    r = client.post("/transaction/reset")
    assert r.status_code == 200
    # reset은 현재 활성 가구(account_book)의 모든 거래를 지운다.
    data = client.get("/transaction/data").json()
    assert all(t["title"] not in ("리셋대상", "pytest 수입") for t in data)


# ──────────────────────────────────────────────────────────────────
# 멀티 가구 격리 / 초대 흐름
# ──────────────────────────────────────────────────────────────────
def _register_login(prefix):
    """새 유저를 만들고 로그인한 (client, uid, book_id, member_id)."""
    c = TestClient(app)
    uid = prefix + uuid.uuid4().hex[:8]
    r = c.post("/auth/register", json={"user_id": uid, "password": TEST_PW, "name": uid, "email": f"{uid}@test.com"})
    assert r.status_code == 201, r.text
    r = c.post("/auth/login", json={"user_id": uid, "password": TEST_PW})
    assert r.status_code == 200, r.text
    book_id = c.get("/auth/me").json()["account_book_id"]
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM members WHERE user_id = %s", (uid,))
        member_id = cur.fetchone()["id"]
    conn.close()
    return c, uid, book_id, member_id


def _cleanup(book_id, member_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM transactions WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM transactions WHERE member_id = %s", (member_id,))
            cur.execute("DELETE FROM recurring_transactions WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM categories WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM settings WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_book_invites WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_book_members WHERE account_book_id = %s", (book_id,))
            cur.execute("DELETE FROM account_book_members WHERE member_id = %s", (member_id,))
            cur.execute("DELETE FROM account_books WHERE id = %s", (book_id,))
            cur.execute("DELETE FROM members WHERE id = %s", (member_id,))
        conn.commit()
    finally:
        conn.close()


def _cleanup_user_id(user_id):
    """user_id로 만들어진 유저와 그 전용 가구를 정리한다(없으면 무시)."""
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM members WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return
        member_id = row["id"]
        cur.execute("SELECT id FROM account_books WHERE member_id = %s", (member_id,))
        book_ids = [b["id"] for b in cur.fetchall()]
    conn.close()
    # 가구가 없어도 member는 지워야 하므로 매칭되지 않는 id로 한 번은 돈다.
    for book_id in book_ids or [0]:
        _cleanup(book_id, member_id)


def _phone_of(user_id):
    conn = get_db_connection()
    with conn.cursor() as cur:
        cur.execute("SELECT phone FROM members WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    conn.close()
    return row["phone"]


def _expense_cat(c):
    cats = c.get("/transaction/categories").json()
    return next(x["id"] for x in cats if x["type"] == "expense")


def test_book_isolation():
    a, _, a_book, a_member = _register_login("iso_a_")
    b, _, b_book, b_member = _register_login("iso_b_")
    try:
        assert a_book != b_book  # 각자 전용 가구

        a_cat = _expense_cat(a)
        r = a.post("/transaction/add", json={"type": "expense", "category_id": a_cat, "amount": 7777, "description": "A만의거래", "date": "2026-06-11"})
        assert r.status_code == 201
        a_txn = next(t for t in a.get("/transaction/data").json() if t["title"] == "A만의거래")

        # B는 A의 거래를 볼 수 없다
        assert all(t["id"] != a_txn["id"] for t in b.get("/transaction/data").json())
        # B는 A의 거래를 지울 수 없다 (다른 가구 → 404)
        assert b.delete(f"/transaction/delete/{a_txn['id']}").status_code == 404
        # B는 A의 카테고리로 거래를 쓸 수 없다 (IDOR-write → 400)
        assert b.post("/transaction/add", json={"type": "expense", "category_id": a_cat, "amount": 100, "description": "탈취시도"}).status_code == 400
    finally:
        _cleanup(a_book, a_member)
        _cleanup(b_book, b_member)


def test_invite_flow():
    a, _, a_book, a_member = _register_login("inv_a_")
    b, b_uid, b_book, b_member = _register_login("inv_b_")
    try:
        # A(owner)가 초대 코드 생성
        r = a.post("/auth/invites")
        assert r.status_code == 201, r.text
        token = r.json()["token"]

        # B가 수락 → 활성 가구가 A의 가구로 바뀐다
        r = b.post("/auth/invites/accept", json={"token": token})
        assert r.status_code == 200, r.text
        assert r.json()["account_book_id"] == a_book
        assert b.get("/auth/me").json()["account_book_id"] == a_book
        assert any(bk["id"] == a_book for bk in b.get("/auth/books").json()["books"])

        # A가 거래를 넣으면 B도 (A 가구로 전환된 상태에서) 볼 수 있다
        a_cat = _expense_cat(a)
        a.post("/transaction/add", json={"type": "expense", "category_id": a_cat, "amount": 3300, "description": "공유거래", "date": "2026-06-12"})
        assert any(t["title"] == "공유거래" for t in b.get("/transaction/data").json())

        # A 가구 멤버 목록에 B가 포함된다
        members = a.get("/auth/books/members").json()["members"]
        assert any(m["member_id"] == b_member for m in members)

        # 수락된 초대가 A의 목록에 accepted + 수락자 이름으로 표시된다
        acc = next(x for x in a.get("/auth/invites").json()["invites"] if x["token"] == token)
        assert acc["status"] == "accepted"
        assert acc["accepted_by_name"] == b_uid

        # 멤버(B, 현재 A 가구의 member)는 초대를 생성할 수 없다 (owner 전용)
        assert b.post("/auth/invites").status_code == 403

        # 이미 멤버인 B가 새 초대를 수락해도 초대는 소비되지 않고 pending으로 남는다
        token2 = a.post("/auth/invites").json()["token"]
        r = b.post("/auth/invites/accept", json={"token": token2})
        assert r.status_code == 200, r.text
        assert r.json()["account_book_id"] == a_book
        again = next(x for x in a.get("/auth/invites").json()["invites"] if x["token"] == token2)
        assert again["status"] == "pending"

        # 만료/무효 토큰 재사용은 거부
        assert b.post("/auth/invites/accept", json={"token": "invalid-xyz"}).status_code == 404
    finally:
        _cleanup(a_book, a_member)
        _cleanup(b_book, b_member)


def test_invite_expiry():
    a, _, a_book, a_member = _register_login("exp_a_")
    b, _, b_book, b_member = _register_login("exp_b_")
    try:
        token = a.post("/auth/invites").json()["token"]

        # 기한을 과거로 강제
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE account_book_invites SET expires_at = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE token = %s",
                (token,),
            )
        conn.commit()
        conn.close()

        # 목록 조회 시 상태가 expired로 정리되어 내려온다
        invites = a.get("/auth/invites").json()["invites"]
        item = next(x for x in invites if x["token"] == token)
        assert item["status"] == "expired"

        # 만료 코드 수락은 410
        assert b.post("/auth/invites/accept", json={"token": token}).status_code == 410
    finally:
        _cleanup(a_book, a_member)
        _cleanup(b_book, b_member)


def test_invite_cap():
    import secrets as _secrets
    from routes.household import _MAX_PENDING_INVITES

    a, _, a_book, a_member = _register_login("cap_a_")
    try:
        # 대기중 초대를 상한까지 직접 채운다
        conn = get_db_connection()
        with conn.cursor() as cur:
            for _ in range(_MAX_PENDING_INVITES):
                cur.execute(
                    """INSERT INTO account_book_invites (account_book_id, token, created_by, expires_at)
                       VALUES (%s, %s, %s, DATE_ADD(NOW(), INTERVAL 7 DAY))""",
                    (a_book, _secrets.token_urlsafe(24), a_member),
                )
        conn.commit()
        conn.close()

        # 상한을 넘는 생성은 429
        assert a.post("/auth/invites").status_code == 429
    finally:
        _cleanup(a_book, a_member)


def test_ai_chat_validation_and_rate_limit():
    # 검증/제한은 Anthropic 호출 이전에 일어나므로 API 키 없이도 검증 가능하다.
    c, _, book_id, member_id = _register_login("ai_")
    try:
        # role 위조/형식 오류 messages는 400
        assert c.post("/ai/chat", json={"messages": [{"role": "system", "content": "x"}]}).status_code == 400
        assert c.post("/ai/chat", json={"messages": "not-a-list"}).status_code == 400

        # 같은 유저가 한도를 넘기면 429 (검증 실패 요청도 rate 카운트에 포함)
        last = None
        for _ in range(25):
            last = c.post("/ai/chat", json={"messages": [{"role": "system", "content": "x"}]})
        assert last.status_code == 429
    finally:
        _cleanup(book_id, member_id)


# ──────────────────────────────────────────────────────────────────
# 입력 검증 / 무차별 대입 방어
# ──────────────────────────────────────────────────────────────────
def test_register_validation():
    c = TestClient(app)
    base = {"user_id": "regval_" + uuid.uuid4().hex[:6], "password": TEST_PW, "name": "n", "email": "a@b.com"}

    def r(**over):
        return c.post("/auth/register", json={**base, **over})

    assert r(password="Ab1!").status_code == 400          # 8자 미만
    assert r(password="TEST1234!").status_code == 400     # 소문자 없음
    assert r(password="test1234!").status_code == 400     # 대문자 없음
    assert r(password="TestTest!").status_code == 400     # 숫자 없음
    assert r(password="TestTest1").status_code == 400     # 특수문자 없음
    assert r(email="not-an-email").status_code == 400  # 이메일 형식 오류
    assert r(user_id="ab").status_code == 400          # 아이디 3자 미만
    assert r(phone="12345").status_code == 400              # 핸드폰: E.164 아님
    assert r(phone="010-1234-5678").status_code == 400      # 국내 표기는 프론트가 E.164로 정규화해 보낸다
    assert r(phone="+8210123456789012").status_code == 400  # E.164 최대 15자리 초과
    # 컬럼이 varchar(100)이라 초과분은 DB 오류(500)가 아니라 400이어야 한다.
    assert r(email="a" * 95 + "@b.com").status_code == 400


def test_register_rejects_duplicates():
    """아이디·이메일 중복은 각각 409로 구분되어야 한다(둘 다 UNIQUE 제약이 있음)."""
    _, uid, book_id, member_id = _register_login("dup_")
    try:
        fresh = TestClient(app)

        def reg(**over):
            body = {
                "user_id": "other_" + uuid.uuid4().hex[:6],
                "password": TEST_PW,
                "name": "중복검사",
                "email": f"fresh{uuid.uuid4().hex[:6]}@test.com",
            }
            return fresh.post("/auth/register", json={**body, **over})

        r = reg(email=f"{uid}@test.com")
        assert r.status_code == 409, r.text
        assert "이메일" in r.json()["error"]

        r = reg(user_id=uid)
        assert r.status_code == 409, r.text
        assert "아이디" in r.json()["error"]

        # 콜레이션이 대소문자를 무시하므로 변형 입력도 409여야 한다(500으로 새면 회귀).
        r = reg(email=f"{uid.upper()}@TEST.COM")
        assert r.status_code == 409, r.text
        assert "이메일" in r.json()["error"]

        r = reg(user_id=uid.upper())
        assert r.status_code == 409, r.text
        assert "아이디" in r.json()["error"]
    finally:
        _cleanup(book_id, member_id)


def test_register_phone_is_optional():
    uid_with = "phon_" + uuid.uuid4().hex[:6]
    uid_without = "noph_" + uuid.uuid4().hex[:6]
    c = TestClient(app)

    def reg(user_id, **over):
        body = {"user_id": user_id, "password": TEST_PW, "name": "폰검사", "email": f"{user_id}@test.com"}
        return c.post("/auth/register", json={**body, **over})

    try:
        assert reg(uid_with, phone="+821012345678").status_code == 201
        assert _phone_of(uid_with) == "+821012345678"

        assert reg(uid_without).status_code == 201
        assert _phone_of(uid_without) is None  # 생략하면 NULL
    finally:
        _cleanup_user_id(uid_with)
        _cleanup_user_id(uid_without)


def test_check_user_id():
    _, uid, book_id, member_id = _register_login("chk_")
    try:
        fresh = TestClient(app)

        r = fresh.post("/auth/check-user-id", json={"user_id": "free_" + uuid.uuid4().hex[:6]})
        assert r.status_code == 200 and r.json()["available"] is True

        r = fresh.post("/auth/check-user-id", json={"user_id": uid})
        assert r.status_code == 200 and r.json()["available"] is False

        assert fresh.post("/auth/check-user-id", json={"user_id": "ab"}).status_code == 400
        assert fresh.post("/auth/check-user-id", json={"user_id": ""}).status_code == 400
    finally:
        _cleanup(book_id, member_id)


def test_add_transaction_validation(client, cat_id):
    bad = [
        {"type": "invalid", "category_id": cat_id, "amount": 100, "description": "x", "date": "2026-06-01"},
        {"type": "expense", "category_id": cat_id, "amount": "abc", "description": "x", "date": "2026-06-01"},
        {"type": "expense", "category_id": cat_id, "amount": -5, "description": "x", "date": "2026-06-01"},
        {"type": "expense", "category_id": cat_id, "amount": 100, "description": "x", "date": "2026/06/01"},
    ]
    for body in bad:
        assert client.post("/transaction/add", json=body).status_code == 400, body
    # 정상 건은 201
    assert client.post(
        "/transaction/add",
        json={"type": "expense", "category_id": cat_id, "amount": 1234, "description": "검증정상", "date": "2026-06-01"},
    ).status_code == 201


def test_login_rate_limit():
    from routes.auth import _LOGIN_MAX

    c, uid, book_id, mid = _register_login("lrl_")
    try:
        last = None
        for _ in range(_LOGIN_MAX + 2):
            last = c.post("/auth/login", json={"user_id": uid, "password": "wrong-pw"})
        assert last.status_code == 429
    finally:
        _cleanup(book_id, mid)


def test_card_credentials_crud():
    c, uid, book_id, mid = _register_login("card_")
    try:
        assert c.get("/transaction/card-credentials").json()["configured"] is False
        # 형식이 잘못된 값은 IMAP 검증 전에 거부된다(네트워크를 타지 않는다)
        assert c.post("/transaction/card-credentials",
                      json={"imap_user": "me@gmail.com", "imap_password": "short"}).status_code == 400
        assert c.post("/transaction/card-credentials",
                      json={"imap_user": "not-an-email", "imap_password": "abcd efgh ijkl mnop"}).status_code == 400
        assert c.post("/transaction/card-credentials",
                      json={"imap_user": "me@gmail.com", "imap_password": "abcd efgh ijkl mnop",
                            "woori_birth": "12"}).status_code == 400

        ok_body = {"imap_user": "me@gmail.com", "imap_password": "abcd efgh ijkl mnop",
                   "woori_birth": "900101"}
        # 여기서부터는 Gmail 로그인 검증을 대역한다. 이 테스트가 보는 건 저장·암호화·
        # 마스킹이지 실제 Gmail 연결이 아니다(가짜 주소로는 당연히 로그인이 안 된다).
        with patch("routes.card_import.verify_imap_login",
                   side_effect=Exception("[AUTHENTICATIONFAILED] Invalid credentials")):
            assert c.post("/transaction/card-credentials", json=ok_body).status_code == 400
            # 로그인이 안 되는 값은 저장까지 가면 안 된다 — "저장됨"이라 해놓고
            # 수집이 하루 뒤에야 조용히 실패하는 게 원래 문제였다.
            assert c.get("/transaction/card-credentials").json()["configured"] is False

        # 정상 저장
        with patch("routes.card_import.verify_imap_login", return_value=None):
            assert c.post("/transaction/card-credentials", json=ok_body).status_code == 200
        st = c.get("/transaction/card-credentials").json()
        assert st["configured"] is True and st["has_woori"] is True
        assert "gmail.com" in st["imap_user_masked"] and st["imap_user_masked"] != "me@gmail.com"
        # 비밀번호는 암호문으로 저장(평문 미포함)
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT imap_password_enc FROM member_email_credentials WHERE member_id = %s", (mid,))
            enc = bytes(cur.fetchone()["imap_password_enc"])
        conn.close()
        assert b"abcdefghijklmnop" not in enc
        # 미설정 사용자로 임포트하면 400
        assert c.delete("/transaction/card-credentials").status_code == 200
        assert c.get("/transaction/card-credentials").json()["configured"] is False
        assert c.post("/transaction/import/card").status_code == 400
    finally:
        _cleanup(book_id, mid)
