"""
routes/health.py — 서버 건강 체크 엔드포인트.

GET /health
  DB 연결과 디스크 여유 공간을 JSON으로 반환. 인증 없이 호출 가능.
"""
import logging
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    components = {}
    all_ok = True

    # ── DB ──────────────────────────────────────────────────
    try:
        from database.db_connection import get_db_connection
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        finally:
            conn.close()
        components["db"] = {"ok": True}
    except Exception as e:
        logger.exception("health DB 체크 실패")
        components["db"] = {"ok": False}
        all_ok = False

    # ── 디스크 공간 ─────────────────────────────────────────
    try:
        import shutil
        total, used, free = shutil.disk_usage("/")
        free_gb = round(free / (1024 ** 3), 1)
        components["disk"] = {
            "ok": free_gb > 1.0,
            "free_gb": free_gb,
            "total_gb": round(total / (1024 ** 3), 1),
        }
        if free_gb <= 1.0:
            all_ok = False
    except Exception as e:
        logger.exception("health 디스크 체크 실패")
        components["disk"] = {"ok": False}

    result = {
        "ok": all_ok,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "components": components,
    }
    return JSONResponse(result, status_code=200 if all_ok else 503)
