import json
import logging
import anthropic
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from config import Config
from database.db_connection import get_db_connection
from routes.utils import get_account_book_id, api_require_login
from datetime import datetime

router = APIRouter()
logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)

SYSTEM_PROMPT = """당신은 가계부 분석 전문 AI 어시스턴트입니다.
사용자의 수입/지출 데이터를 분석하고 유용한 재무 인사이트를 제공합니다.
한국어로 친근하고 명확하게 답변하세요. 금액은 원 단위로 표시하세요."""

TOOLS = [
    {
        "name": "get_monthly_summary",
        "description": "특정 월의 수입/지출 합계와 상세 내역을 조회합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "year":  {"type": "integer", "description": "연도 (예: 2025)"},
                "month": {"type": "integer", "description": "월 (1~12)"}
            },
            "required": ["year", "month"],
            "additionalProperties": False
        }
    },
    {
        "name": "get_category_breakdown",
        "description": "특정 월의 카테고리별 지출 합계를 조회합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "year":  {"type": "integer"},
                "month": {"type": "integer"}
            },
            "required": ["year", "month"],
            "additionalProperties": False
        }
    },
    {
        "name": "get_spending_trend",
        "description": "최근 N개월의 월별 수입/지출 추이를 조회합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "months": {"type": "integer", "description": "조회할 개월 수 (기본 3, 최대 12)"}
            },
            "additionalProperties": False
        }
    }
]


def _run_get_monthly_summary(account_book_id, year, month):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT type, SUM(amount) AS total, COUNT(*) AS cnt
                FROM transactions
                WHERE account_book_id = %s AND YEAR(transaction_date) = %s AND MONTH(transaction_date) = %s
                GROUP BY type
            """, (account_book_id, year, month))
            summary = cur.fetchall()
            cur.execute("""
                SELECT title, amount, type, transaction_date, memo
                FROM transactions
                WHERE account_book_id = %s AND YEAR(transaction_date) = %s AND MONTH(transaction_date) = %s
                ORDER BY transaction_date DESC LIMIT 20
            """, (account_book_id, year, month))
            details = cur.fetchall()
        return {"summary": summary, "recent_transactions": details}
    finally:
        conn.close()


def _run_get_category_breakdown(account_book_id, year, month):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.name AS category, SUM(t.amount) AS total, COUNT(*) AS cnt
                FROM transactions t
                LEFT JOIN categories c ON t.category_id = c.id
                WHERE t.account_book_id = %s AND t.type = 'expense'
                  AND YEAR(t.transaction_date) = %s AND MONTH(t.transaction_date) = %s
                GROUP BY c.name ORDER BY total DESC
            """, (account_book_id, year, month))
            return {"categories": cur.fetchall()}
    finally:
        conn.close()


def _run_get_spending_trend(account_book_id, months=3):
    months = min(max(months, 1), 12)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT YEAR(transaction_date) AS year, MONTH(transaction_date) AS month,
                       type, SUM(amount) AS total
                FROM transactions
                WHERE account_book_id = %s AND transaction_date >= DATE_SUB(CURDATE(), INTERVAL %s MONTH)
                GROUP BY year, month, type ORDER BY year, month
            """, (account_book_id, months))
            return {"trend": cur.fetchall()}
    finally:
        conn.close()


def _execute_tool(tool_name, tool_input, account_book_id):
    try:
        if tool_name == "get_monthly_summary":
            result = _run_get_monthly_summary(account_book_id, tool_input["year"], tool_input["month"])
        elif tool_name == "get_category_breakdown":
            result = _run_get_category_breakdown(account_book_id, tool_input["year"], tool_input["month"])
        elif tool_name == "get_spending_trend":
            result = _run_get_spending_trend(account_book_id, tool_input.get("months", 3))
        else:
            result = {"error": f"알 수 없는 도구: {tool_name}"}
    except Exception as e:
        logger.exception("AI 도구 실행 실패: %s", tool_name)
        result = {"error": "도구 실행 중 오류가 발생했습니다."}
    return json.dumps(result, ensure_ascii=False, default=str)


@router.post('/ai/analyze')
async def analyze(request: Request, _=Depends(api_require_login)):
    data   = await request.json()
    prompt = data.get('prompt', '')
    if not prompt:
        return JSONResponse({"error": "prompt가 없습니다."}, status_code=400)

    def generate():
        try:
            with client.messages.stream(model="claude-sonnet-4-6", max_tokens=8000, system=SYSTEM_PROMPT,
                                        messages=[{"role": "user", "content": prompt}]) as stream:
                for text in stream.text_stream:
                    yield text
        except anthropic.AuthenticationError:
            yield "[오류] API 키가 유효하지 않습니다."
        except anthropic.RateLimitError:
            yield "[오류] API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        except Exception as e:
            logger.exception("AI 분석 스트리밍 실패")
            yield "[오류] 처리 중 오류가 발생했습니다."

    return StreamingResponse(generate(), media_type='text/plain; charset=utf-8')


@router.post('/ai/chat')
async def chat(request: Request, _=Depends(api_require_login)):
    data     = await request.json()
    messages = data.get('messages', [])
    if not messages:
        return JSONResponse({"error": "messages가 없습니다."}, status_code=400)

    def generate():
        try:
            with client.messages.stream(model="claude-sonnet-4-6", max_tokens=8000,
                                        system=SYSTEM_PROMPT, messages=messages) as stream:
                for text in stream.text_stream:
                    yield text
        except anthropic.AuthenticationError:
            yield "[오류] API 키가 유효하지 않습니다."
        except anthropic.RateLimitError:
            yield "[오류] API 요청 한도를 초과했습니다."
        except Exception as e:
            logger.exception("AI 채팅 스트리밍 실패")
            yield "[오류] 처리 중 오류가 발생했습니다."

    return StreamingResponse(generate(), media_type='text/plain; charset=utf-8')


@router.post('/ai/agent')
async def agent(request: Request, _=Depends(api_require_login)):
    data         = await request.json()
    user_message = data.get('message', '')
    if not user_message:
        return JSONResponse({"error": "message가 없습니다."}, status_code=400)

    account_book_id = get_account_book_id(request)
    now = datetime.now()
    system = f"""{SYSTEM_PROMPT}
오늘 날짜: {now.strftime('%Y년 %m월 %d일')}
필요하면 도구를 사용해 실제 데이터를 조회한 뒤 답변하세요."""
    # system 블록에 캐시 breakpoint를 걸면 렌더 순서(tools→system)상 tools까지 함께 캐시되어
    # 에이전트 루프의 매 iteration에서 정적 prefix 재전송 비용을 줄인다.
    system_blocks = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    messages = [{"role": "user", "content": user_message}]

    def generate():
        try:
            while True:
                with client.messages.stream(model="claude-sonnet-4-6", max_tokens=8000,
                                            system=system_blocks, tools=TOOLS, messages=messages) as stream:
                    for text in stream.text_stream:
                        yield text
                    response = stream.get_final_message()

                tool_uses = [b for b in response.content if b.type == "tool_use"]
                if not tool_uses:
                    break

                messages.append({"role": "assistant", "content": response.content})
                tool_results = []
                for tu in tool_uses:
                    yield f"\n[🔍 {tu.name} 조회 중...]\n"
                    result_str = _execute_tool(tu.name, tu.input, account_book_id)
                    tool_results.append({"type": "tool_result", "tool_use_id": tu.id, "content": result_str})
                messages.append({"role": "user", "content": tool_results})

        except anthropic.AuthenticationError:
            yield "[오류] API 키가 유효하지 않습니다."
        except anthropic.RateLimitError:
            yield "[오류] API 요청 한도를 초과했습니다."
        except Exception as e:
            logger.exception("AI 에이전트 스트리밍 실패")
            yield "[오류] 처리 중 오류가 발생했습니다."

    return StreamingResponse(generate(), media_type='text/plain; charset=utf-8')
