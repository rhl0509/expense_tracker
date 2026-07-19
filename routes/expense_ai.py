import base64
import logging
import time
from collections import defaultdict
from threading import Lock

import anthropic
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from config import Config
from database.db_connection import get_db_connection
from routes.utils import get_user_no, api_require_login

router = APIRouter()
logger = logging.getLogger(__name__)

# BYOK: AI 키는 서버 공용이 아니라 사용자별로 DB에 암호화 저장한다. 요청마다 그 사용자의
# 키를 복호화해 클라이언트를 만든다. provider 별 SDK 차이는 _stream_completion 이 흡수한다.
_SUPPORTED_PROVIDERS = ("anthropic", "openai", "gemini")

_MODELS = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o",
    "gemini": "gemini-2.0-flash",
}
_MAX_OUTPUT_TOKENS = 8000


def _stream_completion(provider, api_key, system, messages):
    """provider 별 텍스트 스트리밍 제너레이터. 입력은 공통 형식(system 문자열 +
    messages=[{role: user/assistant, content}]) 이고, SDK 마다 다른 system 위치·role 이름·
    청크 구조를 여기서 흡수한다. SDK 는 실제로 쓸 때만 import 한다."""
    model = _MODELS[provider]
    if provider == "anthropic":
        client = anthropic.Anthropic(api_key=api_key)
        with client.messages.stream(model=model, max_tokens=_MAX_OUTPUT_TOKENS,
                                    system=system, messages=messages) as stream:
            yield from stream.text_stream
    elif provider == "openai":
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        # OpenAI 는 system 을 messages[0] 에 role='system' 으로 넣는다.
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, *messages],
            max_tokens=_MAX_OUTPUT_TOKENS,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    elif provider == "gemini":
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
        # Gemini 는 assistant 를 'model' 로 부르고, system 은 config 로 분리한다.
        contents = [
            types.Content(role=("model" if m["role"] == "assistant" else "user"),
                          parts=[types.Part(text=m["content"])])
            for m in messages
        ]
        stream = client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=_MAX_OUTPUT_TOKENS,
            ),
        )
        for chunk in stream:
            if chunk.text:
                yield chunk.text
    else:
        raise ValueError(f"지원하지 않는 프로바이더: {provider}")


# 카드 자격증명과 같은 메커니즘(cryptography.Fernet)이되, 별도 시크릿(AI_ENC_KEY)이 있으면
# 그것을, 없으면 SECRET_KEY 에서 HKDF 로 도메인 분리해 파생한다. 암호화 키를 교체하면 기존
# 암호문은 복호화 불가 → 사용자가 재입력해야 한다.
def _fernet() -> Fernet:
    base = Config.AI_ENC_KEY or Config.SECRET_KEY
    raw = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"expense_tracker/ai-credentials",
        info=b"member_ai_credentials fernet key v1",
    ).derive(base.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(raw))


def _encrypt(plain: str) -> bytes:
    return _fernet().encrypt(plain.encode("utf-8"))


def _decrypt(token) -> str | None:
    try:
        return _fernet().decrypt(bytes(token)).decode("utf-8")
    except (InvalidToken, TypeError, ValueError):
        return None


def _load_ai_credential(member_id):
    """(provider, api_key) 튜플 또는 None. 복호화 실패(키 교체 등)도 None."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT provider, api_key_enc FROM member_ai_credentials WHERE member_id = %s",
                (member_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    key = _decrypt(row["api_key_enc"])
    if key is None:
        return None
    return row["provider"], key


def _mask_key(key: str) -> str:
    """저장된 키를 화면에 힌트로만 보여준다(앞 5자 + 뒤 4자)."""
    if len(key) <= 12:
        return "****"
    return f"{key[:5]}…{key[-4:]}"


def _validate_key(provider: str, api_key: str) -> tuple[bool, str | None]:
    """저장 전에 실제로 키가 유효한지 확인한다. 모델 목록 조회(토큰 비용 없음)로 인증만 검사.
    provider 마다 예외 타입이 달라, 메시지 문자열로 인증 실패와 그 외를 구분한다."""
    try:
        if provider == "anthropic":
            anthropic.Anthropic(api_key=api_key).models.list(limit=1)
        elif provider == "openai":
            from openai import OpenAI
            OpenAI(api_key=api_key).models.list()
        elif provider == "gemini":
            from google import genai
            # list() 는 지연 이터레이터라 한 건 소비해야 실제 인증 호출이 나간다.
            next(iter(genai.Client(api_key=api_key).models.list()), None)
        else:
            return False, "지원하지 않는 프로바이더입니다."
        return True, None
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("auth", "api key", "api_key", "401", "invalid", "permission", "unauthenticated")):
            return False, "API 키가 유효하지 않습니다. 키를 다시 확인하세요."
        logger.exception("AI 키 검증 중 오류 (provider=%s)", provider)
        return False, "키를 검증하지 못했습니다. 잠시 후 다시 시도해 주세요."

# ── AI 호출 rate limit (유저별 슬라이딩 윈도우, 프로세스 로컬) ──
_RATE_LIMIT = 20      # 윈도우당 최대 요청 수
_RATE_WINDOW = 60     # 초
_rate_hits = defaultdict(list)
_rate_lock = Lock()


def _rate_limited(user_no) -> bool:
    """user_no 기준으로 최근 _RATE_WINDOW초 동안의 요청이 한도를 넘으면 True."""
    now = time.time()
    with _rate_lock:
        hits = _rate_hits[user_no]
        cutoff = now - _RATE_WINDOW
        hits[:] = [t for t in hits if t > cutoff]
        if len(hits) >= _RATE_LIMIT:
            return True
        hits.append(now)
        return False


# ── 채팅 메시지 검증 (클라이언트가 보낸 배열을 그대로 신뢰하지 않는다) ──
_MAX_CHAT_MESSAGES = 40     # 대화 턴 상한
_MAX_MESSAGE_CHARS = 8000   # 메시지 1건 길이 상한
_MAX_TOTAL_CHARS = 24000    # 전체 길이 상한


def _sanitize_chat_messages(raw):
    """role/content만 남긴 안전한 messages 리스트를 반환. 문제가 있으면 (None, 에러문자열)."""
    if not isinstance(raw, list) or not raw:
        return None, "messages가 없습니다."
    if len(raw) > _MAX_CHAT_MESSAGES:
        return None, "대화가 너무 깁니다. 새로 시작해 주세요."
    cleaned = []
    total = 0
    for m in raw:
        if not isinstance(m, dict):
            return None, "메시지 형식이 올바르지 않습니다."
        role = m.get("role")
        content = m.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            return None, "메시지 형식이 올바르지 않습니다."
        content = content.strip()
        if not content:
            continue
        if len(content) > _MAX_MESSAGE_CHARS:
            return None, "메시지가 너무 깁니다."
        total += len(content)
        if total > _MAX_TOTAL_CHARS:
            return None, "대화 내용이 너무 깁니다."
        cleaned.append({"role": role, "content": content})
    if not cleaned or cleaned[-1]["role"] != "user":
        return None, "메시지 형식이 올바르지 않습니다."
    return cleaned, None

SYSTEM_PROMPT = """당신은 가계부 분석 전문 AI 어시스턴트입니다.
사용자의 수입/지출 데이터를 분석하고 유용한 재무 인사이트를 제공합니다.
한국어로 친근하고 명확하게 답변하세요. 금액은 원 단위로 표시하세요."""

@router.post('/ai/analyze')
async def analyze(request: Request, _=Depends(api_require_login)):
    user_no = get_user_no(request)
    if _rate_limited(user_no):
        return JSONResponse({"error": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429)
    cred = _load_ai_credential(user_no)
    if not cred:
        return JSONResponse({"error": "AI 기능을 쓰려면 마이페이지에서 API 키를 먼저 등록하세요."}, status_code=400)
    provider, api_key = cred
    if provider not in _SUPPORTED_PROVIDERS:
        return JSONResponse({"error": "지원하지 않는 프로바이더입니다."}, status_code=400)
    data   = await request.json()
    prompt = (data.get('prompt') or '').strip()
    if not prompt:
        return JSONResponse({"error": "prompt가 없습니다."}, status_code=400)
    if len(prompt) > _MAX_MESSAGE_CHARS:
        return JSONResponse({"error": "요청이 너무 깁니다."}, status_code=400)

    def generate():
        try:
            yield from _stream_completion(provider, api_key, SYSTEM_PROMPT,
                                          [{"role": "user", "content": prompt}])
        except Exception:
            logger.exception("AI 분석 스트리밍 실패 (provider=%s)", provider)
            yield "[오류] 처리 중 오류가 발생했습니다. API 키·잔액을 확인해 주세요."

    return StreamingResponse(generate(), media_type='text/plain; charset=utf-8')


@router.post('/ai/chat')
async def chat(request: Request, _=Depends(api_require_login)):
    user_no = get_user_no(request)
    if _rate_limited(user_no):
        return JSONResponse({"error": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."}, status_code=429)
    cred = _load_ai_credential(user_no)
    if not cred:
        return JSONResponse({"error": "AI 기능을 쓰려면 마이페이지에서 API 키를 먼저 등록하세요."}, status_code=400)
    provider, api_key = cred
    if provider not in _SUPPORTED_PROVIDERS:
        return JSONResponse({"error": "지원하지 않는 프로바이더입니다."}, status_code=400)
    data = await request.json()
    messages, err = _sanitize_chat_messages(data.get('messages'))
    if err:
        return JSONResponse({"error": err}, status_code=400)

    # 클라이언트가 보낸 system(재정 요약 컨텍스트)을 검증 후 사용. 없으면 기본 프롬프트.
    system_raw = data.get('system')
    if system_raw is not None and not isinstance(system_raw, str):
        return JSONResponse({"error": "system 형식이 올바르지 않습니다."}, status_code=400)
    system_prompt = (system_raw or '').strip()
    if len(system_prompt) > _MAX_MESSAGE_CHARS:
        return JSONResponse({"error": "system 프롬프트가 너무 깁니다."}, status_code=400)
    if not system_prompt:
        system_prompt = SYSTEM_PROMPT

    def generate():
        try:
            yield from _stream_completion(provider, api_key, system_prompt, messages)
        except Exception:
            logger.exception("AI 채팅 스트리밍 실패 (provider=%s)", provider)
            yield "[오류] 처리 중 오류가 발생했습니다. API 키·잔액을 확인해 주세요."

    return StreamingResponse(generate(), media_type='text/plain; charset=utf-8')


# ── BYOK: 사용자별 AI 키 관리 (마이페이지) ──────────────────────────────
@router.get('/ai/credentials')
async def get_ai_credentials(request: Request, _=Depends(api_require_login)):
    cred = _load_ai_credential(get_user_no(request))
    if not cred:
        return {"configured": False, "provider": None, "key_hint": None}
    provider, api_key = cred
    return {"configured": True, "provider": provider, "key_hint": _mask_key(api_key)}


@router.put('/ai/credentials')
async def save_ai_credentials(request: Request, _=Depends(api_require_login)):
    data = await request.json()
    provider = (data.get('provider') or 'anthropic').strip()
    api_key = (data.get('api_key') or '').strip()
    if provider not in _SUPPORTED_PROVIDERS:
        return JSONResponse({"error": "지원하지 않는 프로바이더입니다."}, status_code=400)
    if not api_key or len(api_key) > 500:
        return JSONResponse({"error": "API 키를 확인하세요."}, status_code=400)

    # 저장하기 전에 실제로 유효한 키인지 확인한다(카드 자격증명과 같은 원칙) — 형식만 보면
    # "저장됨"이라 해놓고 정작 AI 호출이 조용히 실패한다. 외부 호출이라 스레드풀로 오프로드.
    ok, err = await run_in_threadpool(_validate_key, provider, api_key)
    if not ok:
        return JSONResponse({"error": err}, status_code=400)

    key_enc = _encrypt(api_key)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO member_ai_credentials (member_id, provider, api_key_enc)
                   VALUES (%s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                     provider = VALUES(provider),
                     api_key_enc = VALUES(api_key_enc)""",
                (get_user_no(request), provider, key_enc),
            )
        conn.commit()
    finally:
        conn.close()
    return {"message": "저장되었습니다.", "configured": True, "provider": provider}


@router.delete('/ai/credentials')
async def delete_ai_credentials(request: Request, _=Depends(api_require_login)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM member_ai_credentials WHERE member_id = %s",
                (get_user_no(request),),
            )
        conn.commit()
    finally:
        conn.close()
    return {"message": "삭제되었습니다.", "configured": False}
