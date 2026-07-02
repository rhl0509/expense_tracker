"""
routes/card_import.py — 카드 이메일 명세서 자동 수집 → 가계부 추가.

POST /transaction/import/card?days=40
  Gmail IMAP 로 카드사(현대·KB·우리) 명세서 메일의 HTML 첨부를 받아 파싱하고,
  거래를 transactions 테이블에 삽입한다. (이용금액 기준, 결제수단은 카드사별,
  카테고리는 가맹점명 키워드로 자동 추정하고 미매칭은 '기타') 우리카드는
  VestMail 암호화라 WOORI_BIRTH(생년월일 6자리)가 있어야 복호화·수집한다.
  중복은 (날짜·가맹점·금액·결제수단) 그룹별로 명세서 건수에서 기존 DB 건수를
  뺀 만큼만 삽입해 재수집·동일결제 모두 안전하게 처리한다.
"""
import logging
from collections import Counter

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from config import Config
from database.db_connection import get_db_connection
from routes.utils import get_user_no, get_account_book_id, api_require_login
from card_statement import fetch_all_statements, categorize_merchant

router = APIRouter()
logger = logging.getLogger(__name__)

_FALLBACK_CATEGORY = "기타"


@router.post("/import/card")
async def import_card_statement(request: Request, days: int = 40, _=Depends(api_require_login)):
    user_no = get_user_no(request)

    if not Config.GMAIL_IMAP_USER or not Config.GMAIL_IMAP_PASSWORD:
        return JSONResponse(
            {"error": "GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD 환경변수가 설정되지 않았습니다."},
            status_code=400,
        )

    try:
        rows = fetch_all_statements(
            Config.GMAIL_IMAP_USER, Config.GMAIL_IMAP_PASSWORD, days=days,
            woori_birth=Config.WOORI_BIRTH,
        )
    except Exception as e:
        logger.exception("카드 명세서 메일 수집 실패")
        return JSONResponse({"error": "메일 수집에 실패했습니다."}, status_code=502)

    account_book_id = get_account_book_id(request)
    # (날짜, 가맹점, 금액, 결제수단) 그룹별 명세서 건수
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
    except Exception as e:
        conn.rollback()
        logger.exception("카드 명세서 저장 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()

    return JSONResponse({
        "parsed": len(rows),
        "inserted": inserted,
        "skipped": len(rows) - inserted,
    }, status_code=200)
