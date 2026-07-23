import sys
import os

os.environ['PYTHONIOENCODING'] = 'utf-8'
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from config import Config
from routes.utils import LoginRequired, ApiLoginRequired, BookAccessDenied, IngestAuthFailed

# ── 라우터 import ──
from routes.auth import router as auth_router
from routes.household import router as household_router
from routes.transaction import router as transaction_router
from routes.card_import import router as card_import_router
from routes.expense_ai import router as ai_router
from routes.health import router as health_router
from routes.stock_ingest import router as stock_ingest_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 카드 명세서 자동 수집 스케줄러(데몬 스레드) 기동.
    if Config.CARD_IMPORT_SCHEDULER:
        from routes.card_import import start_scheduler
        start_scheduler()
    yield


app = FastAPI(title="가계부 API", lifespan=lifespan)

# ── 미들웨어 ──
# 프론트(Next.js)는 dev 시 localhost:3010, rewrites 프록시 시 동일 출처.
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=Config.SECRET_KEY,
    same_site="strict",
    https_only=Config.SESSION_COOKIE_SECURE,
)

# ── 예외 핸들러 (순수 JSON API) ──
@app.exception_handler(LoginRequired)
async def _login_required_handler(request: Request, exc: LoginRequired):
    return JSONResponse({"error": "로그인이 필요합니다."}, status_code=401)

@app.exception_handler(ApiLoginRequired)
async def _api_login_required_handler(request: Request, exc: ApiLoginRequired):
    return JSONResponse({"error": "로그인이 필요합니다."}, status_code=401)

@app.exception_handler(BookAccessDenied)
async def _book_access_denied_handler(request: Request, exc: BookAccessDenied):
    return JSONResponse({"error": "해당 가구에 접근할 권한이 없습니다."}, status_code=403)

@app.exception_handler(IngestAuthFailed)
async def _ingest_auth_failed_handler(request: Request, exc: IngestAuthFailed):
    return JSONResponse({"error": "연동 토큰이 유효하지 않습니다."}, status_code=401)

# ── 라우터 등록 ──
app.include_router(auth_router, prefix="/auth")
app.include_router(household_router, prefix="/auth")
app.include_router(transaction_router, prefix="/transaction")
app.include_router(card_import_router, prefix="/transaction")
app.include_router(ai_router)
app.include_router(health_router)
# 주식 앱 연동. prefix 없음 — 라우트가 /integration/* 를 직접 선언한다.
app.include_router(stock_ingest_router)


@app.get("/")
async def root():
    return {"service": "가계부 API", "status": "ok"}


if __name__ == '__main__':
    import uvicorn
    port = int(os.getenv('PORT', '8010'))
    # 컨테이너·배포에선 BIND_HOST=0.0.0.0. 기본은 로컬 전용(127.0.0.1).
    host = os.getenv('BIND_HOST', '127.0.0.1')
    uvicorn.run("app:app", host=host, port=port, reload=False)
