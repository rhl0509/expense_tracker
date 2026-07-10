"""
card_statement 유닛 테스트 — 우리카드 명세서 연도 결정 로직(결정적, DB/네트워크 불필요).

실제 명세서 HTML 은 개인정보라 저장하지 않고, 파서가 보는 구조만 본뜬
합성(fixture) HTML 로 검증한다:
  - 정기 명세서: 본문에 '이용기간 YYYY년 MM월 ...' 존재 → 기간 시작 연·월 기준.
  - [우리카드_재발송] 과거 명세서: '이용기간' 없음 → 메일 제목의 결제일
    (없으면 Date 헤더)로 만든 anchor_date 기준. now().year 폴백은 제거됨.
"""
from datetime import date
from email.message import Message

from card_statement import parse_woori_statement, _woori_anchor_date


def _woori_html(rows, period=None):
    """파서가 요구하는 최소 구조의 합성 우리카드 명세서 HTML.

    rows: [(MM/DD, 가맹점, 금액문자열), ...]. period: '이용기간' 문구(없으면 재발송 레이아웃).
    """
    parts = ["<html><body>"]
    if period:
        parts.append(f"<p>이용기간 : {period}</p>")
    parts.append('<table><tr><td class="txtImport">테스트카드</td></tr>')
    parts.append("<tr><th>이용일자</th><th>이용가맹점</th><th>이용금액</th></tr>")
    for mmdd, merchant, amount in rows:
        parts.append(
            f'<tr><td class="tdcent">{mmdd}</td>'
            f'<td class="tdleft">{merchant}</td>'
            f'<td class="tdcent">{amount}</td></tr>'
        )
    parts.append("<tr><td>청구합계</td><td></td><td>10,000</td></tr></table></body></html>")
    return "".join(parts)


# ── 정기 명세서: '이용기간' 연도 사용 ─────────────────────────────────

def test_regular_single_month():
    html = _woori_html([("01/05", "가맹점A", "5,000")],
                       period="2026년 01월 15일 ~ 2026년 02월 14일")
    rows = parse_woori_statement(html)
    assert [r["date"] for r in rows] == ["2026-01-05"]
    assert rows[0]["card"] == "테스트카드"
    assert rows[0]["amount"] == 5000


def test_regular_year_boundary_dec_to_jan():
    # 이용기간이 2025-12 에 시작해 해를 넘김 → 12월은 2025, 1월은 2026.
    html = _woori_html([("12/20", "가맹점A", "5,000"), ("01/05", "가맹점B", "3,000")],
                       period="2025년 12월 15일 ~ 2026년 01월 14일")
    rows = parse_woori_statement(html)
    assert [r["date"] for r in rows] == ["2025-12-20", "2026-01-05"]


def test_regular_year_boundary_rows_out_of_order():
    # 카드 섹션이 여러 개라 1월 행이 12월 행보다 먼저 나와도, 기간 시작월(12월)
    # 기준이므로 첫 행 순서에 흔들리지 않는다.
    html = _woori_html([("01/05", "가맹점B", "3,000"), ("12/20", "가맹점A", "5,000")],
                       period="2025년 12월 15일 ~ 2026년 01월 14일")
    rows = parse_woori_statement(html)
    assert [r["date"] for r in rows] == ["2026-01-05", "2025-12-20"]


# ── 재발송 명세서: '이용기간' 없음 → anchor_date 사용 ─────────────────

def test_resend_uses_anchor_year():
    # 결제일 2026-01-14 명세서: 12월 거래는 2025, 1월 거래는 2026.
    html = _woori_html([("12/20", "가맹점A", "5,000"), ("01/05", "가맹점B", "3,000")])
    rows = parse_woori_statement(html, anchor_date=date(2026, 1, 14))
    assert [r["date"] for r in rows] == ["2025-12-20", "2026-01-05"]


def test_resend_anchor_late_resend_date():
    # 2026-07-01 에 재발송돼 Date 헤더가 anchor 여도(제목 결제일이 없을 때),
    # 거래일이 anchor 이전 1년 안이면 올바른 연도로 결합된다.
    html = _woori_html([("12/20", "가맹점A", "5,000"), ("01/05", "가맹점B", "3,000")])
    rows = parse_woori_statement(html, anchor_date=date(2026, 7, 1))
    assert [r["date"] for r in rows] == ["2025-12-20", "2026-01-05"]


def test_resend_same_day_as_anchor_keeps_anchor_year():
    html = _woori_html([("01/14", "가맹점A", "5,000")])
    rows = parse_woori_statement(html, anchor_date=date(2026, 1, 14))
    assert [r["date"] for r in rows] == ["2026-01-14"]


def test_no_year_source_returns_empty():
    # '이용기간'도 anchor 도 없으면 연도를 지어내지 않는다(now() 폴백 제거).
    html = _woori_html([("12/20", "가맹점A", "5,000")])
    assert parse_woori_statement(html) == []


# ── anchor 유도: 제목 결제일 → Date 헤더 ──────────────────────────────

def test_anchor_from_subject_payment_date():
    msg = Message()
    msg["Subject"] = "[우리카드_재발송] 테스트 님의 2026년 01월 14일(결제일) 이용대금명세서"
    msg["Date"] = "Wed, 01 Jul 2026 09:00:00 +0900"
    assert _woori_anchor_date(msg) == date(2026, 1, 14)  # 제목이 Date 헤더보다 우선


def test_anchor_falls_back_to_date_header():
    msg = Message()
    msg["Subject"] = "[우리카드] 이용대금명세서"
    msg["Date"] = "Wed, 01 Jul 2026 09:00:00 +0900"
    assert _woori_anchor_date(msg) == date(2026, 7, 1)


def test_anchor_none_when_no_subject_date_and_no_date_header():
    msg = Message()
    msg["Subject"] = "[우리카드] 이용대금명세서"
    assert _woori_anchor_date(msg) is None
