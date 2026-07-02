"""
routes/household.py — 가구(account_book) 멤버십·초대 관리.

/auth 프리픽스로 마운트된다(app.py). 프론트는 /auth/books, /auth/invites ... 로 호출.
  GET    /auth/books            내가 속한 가구 목록
  POST   /auth/books/switch     활성 가구 전환(멤버십 검증 후 세션 갱신)
  GET    /auth/books/members    현재 가구의 멤버 목록
  DELETE /auth/books/members/{member_id}  멤버 내보내기(owner 전용)
  POST   /auth/invites          초대 생성(owner 전용)
  GET    /auth/invites          현재 가구의 초대 목록(대기중/만료/수락됨)
  POST   /auth/invites/accept   토큰으로 초대 수락(로그인 상태)
  POST   /auth/invites/{id}/revoke  초대 취소(owner 전용)
"""
import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, Depends
from fastapi.responses import JSONResponse

from database.db_connection import get_db_connection
from routes.utils import (
    api_require_login, get_user_no, get_account_book_id,
    is_book_member, is_book_owner,
)

router = APIRouter()
logger = logging.getLogger(__name__)

_INVITE_TTL_DAYS = 7


@router.get("/books")
async def list_books(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    active = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT b.id, b.title, m.role
                   FROM account_book_members m
                   JOIN account_books b ON b.id = m.account_book_id
                   WHERE m.member_id = %s
                   ORDER BY (m.role = 'owner') DESC, b.id ASC""",
                (member_id,),
            )
            books = cursor.fetchall()
        return {"active_book_id": active, "books": books}
    finally:
        conn.close()


@router.post("/books/switch")
async def switch_book(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    data = await request.json()
    target = data.get("account_book_id")
    if target is None:
        return JSONResponse({"error": "account_book_id가 필요합니다."}, status_code=400)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_member(cursor, target, member_id):
                return JSONResponse({"error": "해당 가구의 멤버가 아닙니다."}, status_code=403)
        request.session["account_book_id"] = target
        return {"message": "가구를 전환했습니다.", "account_book_id": target}
    finally:
        conn.close()


@router.get("/books/members")
async def list_members(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_member(cursor, book_id, member_id):
                return JSONResponse({"error": "해당 가구의 멤버가 아닙니다."}, status_code=403)
            cursor.execute(
                """SELECT m.member_id, m.role, mem.user_id, mem.name
                   FROM account_book_members m
                   JOIN members mem ON mem.id = m.member_id
                   WHERE m.account_book_id = %s
                   ORDER BY (m.role = 'owner') DESC, m.member_id ASC""",
                (book_id,),
            )
            return {"members": cursor.fetchall()}
    finally:
        conn.close()


@router.delete("/books/members/{target_member_id}")
async def remove_member(target_member_id: int, request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_owner(cursor, book_id, member_id):
                return JSONResponse({"error": "가구장만 멤버를 내보낼 수 있습니다."}, status_code=403)
            if is_book_owner(cursor, book_id, target_member_id):
                return JSONResponse({"error": "가구장은 내보낼 수 없습니다."}, status_code=400)
            cursor.execute(
                "DELETE FROM account_book_members WHERE account_book_id = %s AND member_id = %s AND role <> 'owner'",
                (book_id, target_member_id),
            )
            if cursor.rowcount == 0:
                return JSONResponse({"error": "해당 멤버가 없습니다."}, status_code=404)
        conn.commit()
        return {"message": "멤버를 내보냈습니다."}
    except Exception as e:
        conn.rollback()
        logger.exception("멤버 내보내기 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.post("/invites")
async def create_invite(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    book_id = get_account_book_id(request)
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now() + timedelta(days=_INVITE_TTL_DAYS)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_owner(cursor, book_id, member_id):
                return JSONResponse({"error": "가구장만 초대를 생성할 수 있습니다."}, status_code=403)
            cursor.execute(
                """INSERT INTO account_book_invites
                   (account_book_id, token, created_by, expires_at)
                   VALUES (%s, %s, %s, %s)""",
                (book_id, token, member_id, expires_at),
            )
        conn.commit()
        return JSONResponse(
            {"token": token, "expires_at": expires_at.isoformat(timespec="seconds")},
            status_code=201,
        )
    except Exception as e:
        conn.rollback()
        logger.exception("초대 생성 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.get("/invites")
async def list_invites(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_member(cursor, book_id, member_id):
                return JSONResponse({"error": "해당 가구의 멤버가 아닙니다."}, status_code=403)
            # 조회 시점에 기한이 지난 pending 초대를 expired로 정리해 상태를 항상 정확히 유지한다.
            cursor.execute(
                """UPDATE account_book_invites SET status = 'expired'
                   WHERE account_book_id = %s AND status = 'pending'
                     AND expires_at IS NOT NULL AND expires_at < NOW()""",
                (book_id,),
            )
            conn.commit()
            cursor.execute(
                """SELECT i.id, i.token, i.status, i.expires_at, i.created_at,
                          acc.name AS accepted_by_name
                   FROM account_book_invites i
                   LEFT JOIN members acc ON acc.id = i.accepted_by
                   WHERE i.account_book_id = %s AND i.status IN ('pending', 'expired', 'accepted')
                   ORDER BY i.created_at DESC""",
                (book_id,),
            )
            return {"invites": cursor.fetchall()}
    finally:
        conn.close()


@router.post("/invites/accept")
async def accept_invite(request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    data = await request.json()
    token = (data.get("token") or "").strip()
    if not token:
        return JSONResponse({"error": "token이 필요합니다."}, status_code=400)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, account_book_id, status, expires_at FROM account_book_invites WHERE token = %s",
                (token,),
            )
            inv = cursor.fetchone()
            if not inv:
                return JSONResponse({"error": "유효하지 않은 초대입니다."}, status_code=404)
            expired = inv["status"] == "expired" or (inv["expires_at"] and inv["expires_at"] < datetime.now())
            if expired and inv["status"] in ("pending", "expired"):
                if inv["status"] == "pending":
                    cursor.execute("UPDATE account_book_invites SET status = 'expired' WHERE id = %s", (inv["id"],))
                    conn.commit()
                return JSONResponse({"error": "만료된 초대입니다."}, status_code=410)
            if inv["status"] != "pending":
                return JSONResponse({"error": "유효하지 않은 초대입니다."}, status_code=404)
            book_id = inv["account_book_id"]
            cursor.execute(
                "INSERT IGNORE INTO account_book_members (account_book_id, member_id, role) VALUES (%s, %s, 'member')",
                (book_id, member_id),
            )
            cursor.execute(
                "UPDATE account_book_invites SET status = 'accepted', accepted_by = %s WHERE id = %s",
                (member_id, inv["id"]),
            )
        conn.commit()
        request.session["account_book_id"] = book_id
        return {"message": "가구에 참여했습니다.", "account_book_id": book_id}
    except Exception as e:
        conn.rollback()
        logger.exception("초대 수락 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()


@router.post("/invites/{invite_id}/revoke")
async def revoke_invite(invite_id: int, request: Request, _=Depends(api_require_login)):
    member_id = get_user_no(request)
    book_id = get_account_book_id(request)
    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            if not is_book_owner(cursor, book_id, member_id):
                return JSONResponse({"error": "가구장만 초대를 취소할 수 있습니다."}, status_code=403)
            cursor.execute(
                "UPDATE account_book_invites SET status = 'revoked' WHERE id = %s AND account_book_id = %s AND status = 'pending'",
                (invite_id, book_id),
            )
            if cursor.rowcount == 0:
                return JSONResponse({"error": "취소할 초대가 없습니다."}, status_code=404)
        conn.commit()
        return {"message": "초대를 취소했습니다."}
    except Exception as e:
        conn.rollback()
        logger.exception("초대 취소 실패")
        return JSONResponse({"error": "서버 내부 오류가 발생했습니다."}, status_code=500)
    finally:
        conn.close()
