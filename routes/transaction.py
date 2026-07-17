import csv
import logging
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, Response
from database.db_connection import get_db_connection
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from io import StringIO
from routes.utils import get_user_no, get_account_book_id, api_require_login, is_book_owner

router = APIRouter()
logger = logging.getLogger(__name__)

# 설정 기본값 (settings 테이블에 값이 없을 때 사용)
_DEFAULT_USER_LABELS = ['공용', '남편', '아내']
_DEFAULT_PAYMENT_METHODS = ['현금', '신용카드', '체크카드', '계좌이체']


def _category_belongs_to_book(cursor, category_id, account_book_id):
    """category_id가 해당 가구(account_book)에 속하는지 확인."""
    cursor.execute(
        "SELECT 1 FROM categories WHERE id = %s AND account_book_id = %s",
        (category_id, account_book_id),
    )
    return cursor.fetchone() is not None


def _get_setting_list(cursor, account_book_id, key, default):
    cursor.execute(
        "SELECT setting_value FROM settings WHERE account_book_id = %s AND setting_key = %s",
        (account_book_id, key)
    )
    row = cursor.fetchone()
    if not row or not row['setting_value']:
        return list(default)
    return [v for v in row['setting_value'].split(',') if v]


def _set_setting_list(cursor, account_book_id, key, values):
    value_str = ','.join(values)
    cursor.execute(
        """INSERT INTO settings (account_book_id, setting_key, setting_value)
           VALUES (%s, %s, %s)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)""",
        (account_book_id, key, value_str)
    )


@router.post('/add')
async def add_transaction(request: Request, _=Depends(api_require_login)):
    user_no = get_user_no(request)

    data = await request.json()
    type_val       = data.get('type')
    category_id    = data.get('category_id')
    title          = (data.get('description') or '').strip()
    memo           = data.get('memo') or ''
    payment_method = data.get('payment_method', '현금')
    user_tag       = data.get('user', '공용')
    date_val       = data.get('date') or datetime.now().strftime('%Y-%m-%d')

    if type_val not in ('income', 'expense'):
        return JSONResponse({"error": "type은 income 또는 expense여야 합니다."}, status_code=400)
    if len(title) > 200:
        return JSONResponse({"error": "내용이 너무 깁니다."}, status_code=400)
    if len(memo) > 500:
        return JSONResponse({"error": "메모가 너무 깁니다."}, status_code=400)
    try:
        amount = Decimal(str(data.get('amount')))
    except (InvalidOperation, TypeError, ValueError):
        return JSONResponse({"error": "금액이 올바르지 않습니다."}, status_code=400)
    if not (0 < amount < Decimal('1000000000000')):
        return JSONResponse({"error": "금액이 올바르지 않습니다."}, status_code=400)
    try:
        datetime.strptime(date_val, '%Y-%m-%d')
    except (ValueError, TypeError):
        return JSONResponse({"error": "날짜 형식이 올바르지 않습니다."}, status_code=400)

    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if category_id is not None and not _category_belongs_to_book(cursor, category_id, account_book_id):
                return JSONResponse({"error": "유효하지 않은 카테고리입니다."}, status_code=400)
            cursor.execute(
                "INSERT INTO transactions (account_book_id, category_id, member_id, type, amount, title, memo, transaction_date, payment_method, user) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (account_book_id, category_id, user_no, type_val, amount, title, memo, date_val, payment_method, user_tag)
            )
        conn.commit()
        return JSONResponse({"message": "저장되었습니다."}, status_code=201)
    except Exception as e:
        conn.rollback()
        logger.exception("거래 추가 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.get('/data')
async def get_transactions(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT t.id, t.transaction_date, t.type, t.amount, t.title, t.payment_method, t.user, c.name as category_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.account_book_id = %s
                ORDER BY t.transaction_date DESC, t.id DESC
            """, (account_book_id,))
            return [_serialize_txn(r) for r in cursor.fetchall()]
    except Exception as e:
        logger.exception("거래 목록 조회 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.get('/summary')
async def get_summary(request: Request, _=Depends(api_require_login)):
    first_day = datetime.now().replace(day=1).strftime('%Y-%m-%d')
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT type, SUM(amount) as total FROM transactions WHERE account_book_id = %s AND transaction_date >= %s GROUP BY type",
                (account_book_id, first_day)
            )
            results = cursor.fetchall()
            summary = {"income": 0, "expense": 0}
            for row in results:
                summary[row['type']] = float(row['total'])
            return summary
    finally:
        conn.close()


@router.get('/category-summary')
async def get_category_summary(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT COALESCE(p.name, c.name) AS category_name, SUM(t.amount) AS total_amount, t.type
                FROM transactions t
                JOIN categories c ON t.category_id = c.id
                LEFT JOIN categories p ON c.parent_id = p.id
                WHERE t.account_book_id = %s
                  AND DATE_FORMAT(t.transaction_date, '%%Y-%%m') = DATE_FORMAT(CURDATE(), '%%Y-%%m')
                GROUP BY category_name, t.type ORDER BY total_amount DESC
            """, (account_book_id,))
            return cursor.fetchall()
    finally:
        conn.close()


@router.get('/category-chart')
async def get_category_chart(request: Request, year: int = None, _=Depends(api_require_login)):
    if year is None:
        year = datetime.now().year
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT COALESCE(p.name, c.name) AS label, SUM(t.amount) AS value, t.type
                FROM transactions t
                JOIN categories c ON t.category_id = c.id
                LEFT JOIN categories p ON c.parent_id = p.id
                WHERE t.account_book_id = %s
                  AND YEAR(t.transaction_date) = %s
                GROUP BY label, t.type ORDER BY value DESC
            """, (account_book_id, year))
            rows = cursor.fetchall()
            for row in rows:
                if 'value' in row and row['value'] is not None:
                    row['value'] = float(row['value'])
            return rows
    finally:
        conn.close()


@router.delete('/recurring/delete/{id}')
async def delete_recurring(id: int, request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "DELETE FROM recurring_transactions WHERE id = %s AND account_book_id = %s",
                (id, account_book_id)
            )
            if cursor.rowcount == 0:
                return JSONResponse({"error": "항목 없음"}, status_code=404)
        conn.commit()
        return {"message": "deleted"}
    finally:
        conn.close()


@router.get('/categories')
async def get_categories(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, name, type, parent_id, user FROM categories WHERE account_book_id = %s ORDER BY parent_id ASC, sort_order ASC, id ASC",
                (account_book_id,)
            )
            return cursor.fetchall()
    finally:
        conn.close()


@router.post('/category/add')
async def add_category(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    parent_id = data.get('parent_id')
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if parent_id is not None and not _category_belongs_to_book(cursor, parent_id, account_book_id):
                return JSONResponse({"error": "유효하지 않은 상위 카테고리입니다."}, status_code=400)
            cursor.execute(
                "INSERT INTO categories (account_book_id, name, type, parent_id) VALUES (%s, %s, %s, %s)",
                (account_book_id, data.get('name'), data.get('type'), parent_id)
            )
        conn.commit()
        return JSONResponse({"message": "추가 성공"}, status_code=201)
    finally:
        conn.close()


@router.get('/recurring/list')
async def get_recurring_list(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT r.*, c.name as category_name
                FROM recurring_transactions r
                LEFT JOIN categories c ON r.category_id = c.id
                WHERE r.account_book_id = %s
                ORDER BY r.repeat_day ASC
            """, (account_book_id,))
            rows = cursor.fetchall()
            for row in rows:
                if isinstance(row.get('amount'), Decimal):
                    row['amount'] = float(row['amount'])
                if isinstance(row.get('created_at'), (datetime, date)):
                    row['created_at'] = row['created_at'].strftime('%Y-%m-%d')
                if isinstance(row.get('last_processed_month'), (datetime, date)):
                    row['last_processed_month'] = row['last_processed_month'].strftime('%Y-%m-%d')
            return rows
    finally:
        conn.close()


@router.post('/recurring/add')
async def add_recurring(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    category_id = data.get('category_id')
    title       = (data.get('title') or '').strip()
    type_val    = data.get('type')
    user_tag    = data.get('user') or '공용'
    payment     = (data.get('payment_method') or '').strip() or None
    if payment and len(payment) > 50:
        return JSONResponse({"error": "결제수단이 올바르지 않습니다."}, status_code=400)
    if not title or len(title) > 200:
        return JSONResponse({"error": "제목이 올바르지 않습니다."}, status_code=400)
    if type_val not in ('income', 'expense'):
        return JSONResponse({"error": "type은 income 또는 expense여야 합니다."}, status_code=400)
    try:
        repeat_day = int(data.get('repeat_day'))
        amount = Decimal(str(data.get('amount')))
    except (InvalidOperation, TypeError, ValueError):
        return JSONResponse({"error": "반복일 또는 금액이 올바르지 않습니다."}, status_code=400)
    if not (1 <= repeat_day <= 31):
        return JSONResponse({"error": "반복일은 1~31 사이여야 합니다."}, status_code=400)
    if not (0 < amount < Decimal('1000000000000')):
        return JSONResponse({"error": "금액이 올바르지 않습니다."}, status_code=400)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if category_id is not None and not _category_belongs_to_book(cursor, category_id, account_book_id):
                return JSONResponse({"error": "유효하지 않은 카테고리입니다."}, status_code=400)
            cursor.execute(
                "INSERT INTO recurring_transactions (account_book_id, category_id, title, type, repeat_day, user, payment_method, amount) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (account_book_id, category_id, title, type_val, repeat_day, user_tag, payment, amount)
            )
        conn.commit()
        return JSONResponse({"message": "success"}, status_code=201)
    finally:
        conn.close()


@router.post('/process-recurring')
async def process_recurring(request: Request, _=Depends(api_require_login)):
    user_no = get_user_no(request)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    today = datetime.now()
    current_month_str = today.strftime('%Y-%m-01')
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM recurring_transactions WHERE account_book_id = %s AND repeat_day <= %s AND (last_processed_month IS NULL OR last_processed_month < %s)",
                (account_book_id, today.day, current_month_str)
            )
            settings = cursor.fetchall()
            for s in settings:
                reg_date = today.replace(day=s['repeat_day']).strftime('%Y-%m-%d')
                # payment_method 를 같이 넣는다. 안 넣으면 매달 자동 생성되는 구독료가
                # "어느 카드로 나갔는지" 없이 쌓여 결제수단별 통계에서 전부 빠진다.
                cursor.execute(
                    "INSERT INTO transactions (account_book_id, member_id, category_id, type, amount, title, memo, payment_method, transaction_date) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (account_book_id, user_no, s['category_id'], s['type'], s['amount'], s['title'], '정기결제 자동생성', s.get('payment_method'), reg_date)
                )
                cursor.execute("UPDATE recurring_transactions SET last_processed_month = %s WHERE id = %s", (current_month_str, s['id']))
        conn.commit()
        return {"status": "success", "processed": len(settings)}
    except Exception as e:
        conn.rollback()
        logger.exception("정기결제 처리 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.delete('/delete/{transaction_id}')
async def delete_transaction(transaction_id: int, request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM transactions WHERE id = %s AND account_book_id = %s", (transaction_id, account_book_id))
            if cursor.rowcount == 0:
                return JSONResponse({"error": "항목 없음"}, status_code=404)
        conn.commit()
        return {"message": "deleted"}
    finally:
        conn.close()


@router.get('/payment-summary')
async def get_payment_summary(request: Request, year: int = None, _=Depends(api_require_login)):
    if year is None:
        year = datetime.now().year
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT payment_method, SUM(amount) as total
                FROM transactions
                WHERE account_book_id = %s AND type = 'expense'
                  AND YEAR(transaction_date) = %s
                GROUP BY payment_method ORDER BY total DESC
            """, (account_book_id, year))
            return cursor.fetchall()
    finally:
        conn.close()


@router.get('/export')
async def export_csv(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT transaction_date, type, title, amount, payment_method FROM transactions WHERE account_book_id = %s ORDER BY transaction_date DESC",
                (account_book_id,)
            )
            rows = cursor.fetchall()
            si = StringIO()
            cw = csv.writer(si)
            cw.writerow(['날짜', '구분', '내용', '금액', '결제수단'])
            for r in rows:
                cw.writerow([r['transaction_date'], r['type'], r['title'], int(r['amount']), r['payment_method']])
            return Response(
                content=si.getvalue(),
                media_type="text/csv; charset=utf-8-sig",
                headers={"Content-Disposition": "attachment; filename=my_account_book.csv"}
            )
    finally:
        conn.close()


@router.post('/category/update-user')
async def update_category_user(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    category_id = data.get('id')
    new_user    = data.get('user')
    if not category_id or not new_user:
        return JSONResponse({"error": "필수 값이 없습니다."}, status_code=400)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE categories SET user = %s WHERE id = %s AND account_book_id = %s",
                (new_user, category_id, account_book_id)
            )
        conn.commit()
        return {"message": "변경 완료"}
    except Exception as e:
        conn.rollback()
        logger.exception("카테고리 사용자 변경 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.get('/monthly-summary')
async def get_monthly_summary(request: Request, year: int = None, _=Depends(api_require_login)):
    if year is None:
        year = datetime.now().year
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT
                    MONTH(t.transaction_date) AS month,
                    COALESCE(p.name, c.name) AS category_name,
                    t.type,
                    SUM(t.amount) AS total
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                LEFT JOIN categories p ON c.parent_id = p.id
                WHERE t.account_book_id = %s AND YEAR(t.transaction_date) = %s
                GROUP BY month, category_name, t.type
                ORDER BY month ASC
            """, (account_book_id, year))
            rows = cursor.fetchall()
            for row in rows:
                if isinstance(row.get('total'), Decimal):
                    row['total'] = float(row['total'])
            return rows
    finally:
        conn.close()


@router.delete('/category/delete/{category_id}')
async def delete_category(category_id: int, request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM categories WHERE id = %s AND account_book_id = %s",
                (category_id, account_book_id)
            )
            if not cursor.fetchone():
                return JSONResponse({"error": "항목 없음"}, status_code=404)
            cursor.execute(
                "SELECT id FROM categories WHERE parent_id = %s AND account_book_id = %s",
                (category_id, account_book_id)
            )
            sub_categories = cursor.fetchall()
            if sub_categories:
                sub_ids = [s['id'] for s in sub_categories]
                placeholders = ','.join(['%s'] * len(sub_ids))
                cursor.execute(f"UPDATE transactions SET category_id = NULL WHERE category_id IN ({placeholders})", sub_ids)
                cursor.execute("DELETE FROM categories WHERE parent_id = %s AND account_book_id = %s", (category_id, account_book_id))
            cursor.execute("UPDATE transactions SET category_id = NULL WHERE category_id = %s", (category_id,))
            cursor.execute("DELETE FROM categories WHERE id = %s AND account_book_id = %s", (category_id, account_book_id))
        conn.commit()
        return {"message": "deleted"}
    except Exception as e:
        conn.rollback()
        logger.exception("카테고리 삭제 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


def _serialize_txn(row):
    """거래 행의 Decimal/날짜를 JSON 친화 타입으로 변환."""
    if isinstance(row.get('amount'), Decimal):
        row['amount'] = float(row['amount'])
    for k in ('date', 'transaction_date'):
        if isinstance(row.get(k), (datetime, date)):
            row[k] = row[k].strftime('%Y-%m-%d')
    return row


@router.get('/recent')
async def get_recent(request: Request, limit: int = 10, _=Depends(api_require_login)):
    limit = min(max(limit, 1), 100)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                SELECT t.id, t.transaction_date, t.type, t.amount, t.title, t.memo,
                       t.payment_method, t.user, c.name AS category_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.account_book_id = %s
                ORDER BY t.transaction_date DESC, t.id DESC
                LIMIT %s
            """, (account_book_id, limit))
            return [_serialize_txn(r) for r in cursor.fetchall()]
    finally:
        conn.close()


@router.get('/list')
async def get_list(request: Request, year: int = None, month: int = None, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            sql = """
                SELECT t.id, t.transaction_date AS date, t.type, t.amount, t.title, t.memo,
                       t.payment_method, t.user, c.name AS category_name
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.account_book_id = %s
            """
            params = [account_book_id]
            if year is not None:
                sql += " AND YEAR(t.transaction_date) = %s"
                params.append(year)
            if month is not None:
                sql += " AND MONTH(t.transaction_date) = %s"
                params.append(month)
            sql += " ORDER BY t.transaction_date DESC, t.id DESC"
            cursor.execute(sql, params)
            return [_serialize_txn(r) for r in cursor.fetchall()]
    finally:
        conn.close()


@router.get('/yearly-summary')
async def get_yearly_summary(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT type, SUM(amount) AS total FROM transactions
                   WHERE account_book_id = %s AND YEAR(transaction_date) = YEAR(CURDATE())
                   GROUP BY type""",
                (account_book_id,)
            )
            summary = {"income": 0, "expense": 0}
            for row in cursor.fetchall():
                summary[row['type']] = float(row['total'])
            return summary
    finally:
        conn.close()


@router.post('/reset')
async def reset_data(request: Request, _=Depends(api_require_login)):
    user_no = get_user_no(request)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            # 가구 전체 거래를 삭제하는 파괴적 작업 → 가구장(owner)만 허용
            if not is_book_owner(cursor, account_book_id, user_no):
                return JSONResponse({"error": "가구장만 데이터를 초기화할 수 있습니다."}, status_code=403)
            cursor.execute("DELETE FROM transactions WHERE account_book_id = %s", (account_book_id,))
        conn.commit()
        return {"message": "reset", "deleted": cursor.rowcount}
    finally:
        conn.close()


@router.get('/settings/user-labels')
async def get_user_labels(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            return _get_setting_list(cursor, account_book_id, 'user_labels', _DEFAULT_USER_LABELS)
    finally:
        conn.close()


@router.post('/settings/user-labels')
async def save_user_labels(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    labels = [str(x).strip() for x in data.get('labels', []) if str(x).strip()]
    if not labels:
        return JSONResponse({"error": "최소 1개의 항목이 필요합니다."}, status_code=400)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            _set_setting_list(cursor, account_book_id, 'user_labels', labels)
        conn.commit()
        return {"message": "saved", "labels": labels}
    finally:
        conn.close()


@router.get('/settings/payment-methods')
async def get_payment_methods(request: Request, _=Depends(api_require_login)):
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            return _get_setting_list(cursor, account_book_id, 'payment_methods', _DEFAULT_PAYMENT_METHODS)
    finally:
        conn.close()


@router.post('/settings/payment-methods')
async def save_payment_methods(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    methods = [str(x).strip() for x in data.get('methods', []) if str(x).strip()]
    if not methods:
        return JSONResponse({"error": "최소 1개의 결제수단이 필요합니다."}, status_code=400)
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            _set_setting_list(cursor, account_book_id, 'payment_methods', methods)
        conn.commit()
        return {"message": "saved", "methods": methods}
    finally:
        conn.close()


@router.post('/category/reorder')
async def reorder_categories(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    ids = data.get('ids', [])
    account_book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            for order, cat_id in enumerate(ids):
                cursor.execute(
                    "UPDATE categories SET sort_order = %s WHERE id = %s AND account_book_id = %s",
                    (order, cat_id, account_book_id)
                )
        conn.commit()
        return {"message": "reordered"}
    finally:
        conn.close()
