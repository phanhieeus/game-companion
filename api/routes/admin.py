"""Trang quan sát cho người phát triển (C-023).

Đọc những gì C-022 ghi: chuỗi ReAct, prompt đã gửi, tham số gọi tool, sự kiện
guardrail, và số liệu tổng hợp.

**Người chơi vẫn không cần đăng nhập (ADR 2).** Đây là chìa riêng cho chế độ
quan sát, vì trang này lộ nguyên văn prompt và dữ liệu phiên của người khác.
"""

from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse


def admin_token() -> str | None:
    return os.environ.get("ADMIN_TOKEN") or None


def build_admin_router(trace_store, repo, session_store=None) -> APIRouter:
    """`session_store` là kho phiên trong RAM của router agent (C-029).

    TIÊM VÀO chứ không import từ `routes/agent.py`: hai module route import chéo
    nhau là vòng phụ thuộc, và nó buộc kho phiên phải là biến toàn cục — thứ
    khiến test dựng app nhiều lần thừa hưởng phiên của app trước.

    Tên KHÔNG phải `sessions`: route `GET /sessions` ngay dưới cũng tên đó, và
    một hàm def trong cùng closure sẽ đè mất tham số — con số đọc ra sẽ là
    `len(<function>)`, tức nổ ngay tại chỗ. Đã dẫm phải một lần lúc gộp.

    Cho phép `None` để trang quan sát vẫn dựng được khi không ai đưa kho vào;
    lúc đó số liệu chỉ thiếu đúng ô này chứ không sập cả trang.
    """
    router = APIRouter()

    def denied() -> JSONResponse:
        # 401 rỗng: sai token thì không nói thêm gì. Báo "token sai" hay "thiếu
        # header" đều là chỉ đường cho người đang dò.
        return JSONResponse(
            status_code=401,
            content={
                "error": {"code": "UNAUTHORIZED", "message": "Không có quyền."},
                "retryable": False,
            },
        )

    def ok_token(header: str | None, query: str | None) -> bool:
        expected = admin_token()
        if not expected:
            return False
        given = header or query or ""
        # So sánh theo thời gian hằng số: so bằng `==` thì thời gian trả lời rò
        # rỉ từng ký tự đúng, dò dần ra được cả token.
        return hmac.compare_digest(given, expected)

    @router.get("/sessions")
    def sessions(
        x_admin_token: str | None = Header(default=None),
        token: str | None = Query(default=None),
        limit: int = 50,
    ):
        if not ok_token(x_admin_token, token):
            return denied()
        rows = trace_store.sessions(limit=limit)
        # Ghép thêm trạng thái phiên để biết ván nào còn đang chơi.
        for row in rows:
            session = repo.get(row["sessionId"])
            row["status"] = session.status if session else "không còn"
            row["players"] = [p.name for p in session.players] if session else []
            row["rounds"] = (
                len([r for r in session.rounds if r.status == "recorded"])
                if session
                else 0
            )
        return {"sessions": rows}

    @router.get("/sessions/{session_id}/turns")
    def turns(
        session_id: str,
        x_admin_token: str | None = Header(default=None),
        token: str | None = Query(default=None),
        limit: int = 50,
    ):
        if not ok_token(x_admin_token, token):
            return denied()
        return {"turns": trace_store.list(session_id, limit=limit)}

    @router.get("/stats")
    def stats(
        x_admin_token: str | None = Header(default=None),
        token: str | None = Query(default=None),
    ):
        if not ok_token(x_admin_token, token):
            return denied()
        data = trace_store.stats()
        # Phiên agent nằm trong RAM của tiến trình, không nằm ở kho vết, nên
        # không có cách nào đếm ngược ra được từ dữ liệu đã lưu — phải hỏi thẳng
        # chỗ giữ nó. Con số này là lý do C-029 tồn tại: trước đó không ai biết
        # server đang ôm bao nhiêu phiên, kể cả người viết ra nó.
        if session_store is not None:
            session_store.sweep(lambda sid: repo.get(sid) is not None)
            data["sessionsInMemory"] = {
                "count": len(session_store),
                "limit": session_store.limit,
            }
        return data

    return router
