# -*- coding: utf-8 -*-
"""수집 원장(card_import_ledger) 중복방지 테스트 — routes/card_import.py.

실 MySQL 에는 아직 원장 테이블이 없으므로(마이그레이션 005 미적용) SQLite 파일
DB 로 get_db_connection 을 대체해 _insert_rows 의 동작 계약을 검증한다:
  1) 재실행 idempotent  2) 삭제 후 재수집 시 부활 안 함(H3-a)
  3) 수정 후 재수집 시 이중기장 안 함(H3-b)  4) 동시/이중 요청 시 유니크로 1건만(M4)
  5) 동일 라인 다건(line_seq)·재발송 첨부 중복 처리
SQLite 쉼은 DictCursor·%s 플레이스홀더·duplicate-key(1062) 를 pymysql 과 같게
흉내 낸다(UNIQUE 위반 → pymysql.err.IntegrityError(1062, ...)).
"""
import sqlite3
import threading
from decimal import Decimal

import pytest
from pymysql.err import IntegrityError

import routes.card_import as ci

BOOK = 2
USER = 4


# ── SQLite 쉼: pymysql(DictCursor) 호환 최소 구현 ─────────────────────
class _Cursor:
    def __init__(self, conn):
        self._cur = conn.cursor()

    def execute(self, query, args=None):
        q = query.replace("%s", "?")
        try:
            return self._cur.execute(q, tuple(args) if args else ())
        except sqlite3.IntegrityError as e:
            if "UNIQUE" in str(e):
                raise IntegrityError(1062, str(e)) from e
            raise IntegrityError(1452, str(e)) from e

    def fetchone(self):
        row = self._cur.fetchone()
        return dict(row) if row is not None else None

    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]

    @property
    def lastrowid(self):
        return self._cur.lastrowid

    def close(self):
        self._cur.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class _Conn:
    def __init__(self, path):
        self._conn = sqlite3.connect(path, timeout=30)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA busy_timeout=30000")

    def cursor(self):
        return _Cursor(self._conn)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


_SCHEMA = """
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_book_id INTEGER, name TEXT, type TEXT);
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_book_id INTEGER, category_id INTEGER, member_id INTEGER,
    type TEXT, amount NUMERIC, title TEXT, memo TEXT,
    transaction_date TEXT, payment_method TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, user TEXT);
CREATE TABLE card_import_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_book_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    line_seq INTEGER NOT NULL DEFAULT 1,
    transaction_date TEXT NOT NULL, merchant TEXT NOT NULL,
    amount NUMERIC NOT NULL, payment_method TEXT NOT NULL,
    member_id INTEGER, transaction_id INTEGER,
    first_imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_book_id, fingerprint, line_seq));
"""


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "ledger_test.sqlite3")
    seed = sqlite3.connect(path)
    seed.executescript(_SCHEMA)
    seed.execute(
        "INSERT INTO categories (account_book_id, name, type) VALUES (?, '기타', 'expense')",
        (BOOK,),
    )
    seed.execute(
        "INSERT INTO categories (account_book_id, name, type) VALUES (?, '식비', 'expense')",
        (BOOK,),
    )
    seed.commit()
    seed.close()
    monkeypatch.setattr(ci, "get_db_connection", lambda: _Conn(path))
    return path


def _q(path, sql, args=()):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


def _row(merchant="남원추어탕통마늘오리", amount=11000, date="2026-05-01",
         pm="현대카드", stmt="현대카드/1/a.html"):
    return {"date": date, "merchant": merchant, "amount": amount,
            "payment_method": pm, "card": "Amex Gold Ed2", "relation": "본인",
            "_stmt": stmt}


# ── 지문 결정성·정규화 ────────────────────────────────────────────────
def test_fingerprint_roundtrip_int_vs_decimal():
    # 파서(int) ↔ DB(DECIMAL(15,2)) 금액이 같은 지문이어야 백필이 맞는다.
    assert ci.statement_fingerprint("2026-05-01", "가맹점", 11000, "현대카드") == \
           ci.statement_fingerprint("2026-05-01", "가맹점", Decimal("11000.00"), "현대카드")


def test_fingerprint_normalizes_space_and_case():
    base = ci.statement_fingerprint("2026-03-03", "MERCURE 4331", 505543, "우리카드")
    assert ci.statement_fingerprint("2026-03-03", "MERCURE         4331", 505543, "우리카드") == base
    assert ci.statement_fingerprint("2026-03-03", " mercure 4331 ", 505543, "우리카드") == base
    # 다른 금액·날짜·결제수단은 다른 지문
    assert ci.statement_fingerprint("2026-03-03", "MERCURE 4331", 505544, "우리카드") != base
    assert ci.statement_fingerprint("2026-03-04", "MERCURE 4331", 505543, "우리카드") != base
    assert ci.statement_fingerprint("2026-03-03", "MERCURE 4331", 505543, "KB카드") != base


# ── 기본 삽입·재실행 idempotent ───────────────────────────────────────
def test_import_then_rerun_is_idempotent(db):
    rows = [_row(), _row(merchant="카페ABC", amount=4500)]
    assert ci._insert_rows(USER, BOOK, rows) == 2
    assert ci._insert_rows(USER, BOOK, rows) == 0  # 재실행 → 0건
    txs = _q(db, "SELECT title, amount, memo, category_id FROM transactions ORDER BY id")
    assert len(txs) == 2
    assert txs[0]["memo"] == "Amex Gold Ed2/본인 · 현대카드 명세서 자동수집"
    ledger = _q(db, "SELECT fingerprint, line_seq, transaction_id FROM card_import_ledger")
    assert len(ledger) == 2 and all(l["transaction_id"] for l in ledger)


def test_identical_lines_get_line_seq(db):
    # 같은 명세서에 완전 동일 라인 3건(오락실 1,000원 x3) → 3건 모두 삽입.
    rows = [_row(merchant="대빵오락실", amount=1000) for _ in range(3)]
    assert ci._insert_rows(USER, BOOK, rows) == 3
    seqs = sorted(l["line_seq"] for l in _q(db, "SELECT line_seq FROM card_import_ledger"))
    assert seqs == [1, 2, 3]
    assert ci._insert_rows(USER, BOOK, rows) == 0  # 재실행 idempotent
    # 다음 수집 창에 그중 1건만 보여도 재삽입되지 않는다(seq 1 이 원장에 있음).
    assert ci._insert_rows(USER, BOOK, rows[:1]) == 0


def test_resent_statement_in_same_batch_collapses(db):
    # 원본+재발송 첨부가 한 배치에 함께 들어오면 (지문,seq) 셋이 같아 한 벌만 삽입.
    original = [_row(stmt="우리카드/1/a.html"), _row(stmt="우리카드/1/a.html")]
    resend = [_row(stmt="우리카드/9/resend.html"), _row(stmt="우리카드/9/resend.html")]
    assert ci._insert_rows(USER, BOOK, original + resend) == 2


# ── H3-a: 삭제 부활 차단 ──────────────────────────────────────────────
def test_deleted_transaction_is_not_resurrected(db):
    rows = [_row()]
    assert ci._insert_rows(USER, BOOK, rows) == 1
    conn = sqlite3.connect(db)
    conn.execute("DELETE FROM transactions")
    conn.commit(); conn.close()
    assert ci._insert_rows(USER, BOOK, rows) == 0  # 원장이 남아 있어 skip
    assert _q(db, "SELECT COUNT(*) c FROM transactions")[0]["c"] == 0


# ── H3-b: 수정 이중기장 차단 ──────────────────────────────────────────
def test_edited_transaction_is_not_duplicated(db):
    rows = [_row()]
    assert ci._insert_rows(USER, BOOK, rows) == 1
    conn = sqlite3.connect(db)
    conn.execute("UPDATE transactions SET title = '내가 고친 이름', amount = 99999")
    conn.commit(); conn.close()
    assert ci._insert_rows(USER, BOOK, rows) == 0  # 지문은 원장 기준 → skip
    assert _q(db, "SELECT COUNT(*) c FROM transactions")[0]["c"] == 1


# ── M4: 동시/이중 요청 레이스 ─────────────────────────────────────────
def test_race_ledger_already_seeded_skips(db):
    # 경쟁에서 진 쪽이 보는 상태를 결정적으로 재현: 원장에 지문만 있고 거래행 없음.
    r = _row()
    fp = ci.statement_fingerprint(r["date"], r["merchant"], r["amount"], r["payment_method"])
    conn = sqlite3.connect(db)
    conn.execute(
        """INSERT INTO card_import_ledger
           (account_book_id, fingerprint, line_seq, transaction_date, merchant,
            amount, payment_method, member_id) VALUES (?,?,?,?,?,?,?,?)""",
        (BOOK, fp, 1, r["date"], r["merchant"], r["amount"], r["payment_method"], USER),
    )
    conn.commit(); conn.close()
    assert ci._insert_rows(USER, BOOK, [r]) == 0
    assert _q(db, "SELECT COUNT(*) c FROM transactions")[0]["c"] == 0


def test_concurrent_double_request_inserts_once(db):
    rows = [_row(), _row(merchant="카페ABC", amount=4500)]
    results = {}
    barrier = threading.Barrier(2)

    def run(name):
        barrier.wait()
        results[name] = ci._insert_rows(USER, BOOK, rows)

    threads = [threading.Thread(target=run, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(results.values()) == 2  # 두 요청 합쳐 정확히 한 벌
    assert _q(db, "SELECT COUNT(*) c FROM transactions")[0]["c"] == 2
    assert _q(db, "SELECT COUNT(*) c FROM card_import_ledger")[0]["c"] == 2


# ── 스코프: 장부별 원장 (다중 장부 사용 보존 — M3 는 남은 이슈) ────────
def test_scope_is_per_account_book(db):
    seed = sqlite3.connect(db)
    seed.execute("INSERT INTO categories (account_book_id, name, type) VALUES (5, '기타', 'expense')")
    seed.commit(); seed.close()
    rows = [_row()]
    assert ci._insert_rows(USER, BOOK, rows) == 1
    assert ci._insert_rows(USER, 5, rows) == 1  # 다른 장부엔 독립적으로 들어간다


# ── 상한: _MAX_IMPORT_INSERT 유지 ─────────────────────────────────────
def test_insert_cap_respected(db, monkeypatch):
    monkeypatch.setattr(ci, "_MAX_IMPORT_INSERT", 3)
    rows = [_row(merchant=f"가맹점{i}", amount=1000 + i) for i in range(10)]
    assert ci._insert_rows(USER, BOOK, rows) == 3
