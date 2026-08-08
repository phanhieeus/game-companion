"""REST cho mọi thao tác TAY trên phiên (ADR 13).

Mọi endpoint đi qua đúng tool layer đã có — không có đường nào chạm thẳng vào
repository. Nhờ vậy validate zero-sum, nhật ký và undo/redo dùng chung một đường
với agent.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from ..domain.errors import Result
from ..domain.models import DraftEntry
from ..domain.scoring import compute_scoreboard
from ..repository.base import SessionRepository
from ..tools import Tools
from .schemas import (
    ActiveView,
    ErrorBody,
    EventsView,
    LabeledView,
    SessionView,
    UndoState,
)


def error_response(code: str, message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message}, "retryable": status >= 500},
    )


def fail(result: Result) -> JSONResponse:
    """Đưa `Result` hỏng ra HTTP, GIỮ NGUYÊN `code`.

    MỌI `ErrorCode` trong `domain/errors.py` đều là "người dùng/luật chơi", không
    mã nào nghĩa là "máy hỏng" — nên tất cả ra 400 và `retryable: false`. Nói lại
    y hệt câu cũ thì vẫn sai y hệt.

    Giữ `code` vì client cần phân biệt "tổng ván chưa bằng 0" với "mất mạng" để
    quyết có hiện nút Thử lại hay không.
    """
    assert result.error is not None
    return error_response(result.error.code, result.error.message, 400)


def entries_of(raw: Any) -> list[DraftEntry]:
    return [
        DraftEntry(playerId=str(e.get("playerId", "")), delta=int(e.get("delta", 0)))
        for e in (raw or [])
    ]


#: Lỗi luật chơi trả 400 và GIỮ NGUYÊN `code` — khai vào OpenAPI để client sinh
#: kiểu cho cả nhánh hỏng, không chỉ nhánh thành công.
ERRORS: dict = {400: {"model": ErrorBody}, 404: {"model": ErrorBody}}

#: Phần lớn endpoint trả về cùng một hình dạng: phiên + bảng điểm.
VIEW: dict = {
    "response_model": SessionView,
    # `endedAt: None` phải VẮNG khỏi JSON cho khớp `field?:` của TypeScript —
    # client phân biệt "chưa kết thúc" bằng sự vắng mặt của field.
    "response_model_exclude_none": True,
    "responses": ERRORS,
}


def build_session_router(tools: Tools, repo: SessionRepository) -> APIRouter:
    router = APIRouter()

    def view(session_id: str) -> dict | None:
        """Phiên + bảng điểm luôn đi cùng nhau: client không tự tính điểm nữa."""
        session = repo.get(session_id)
        if session is None:
            return None
        return {
            "session": session.dump(),
            "scoreboard": compute_scoreboard(session).dump(),
        }

    def viewed(session_id: str, extra: dict | None = None):
        payload = view(session_id)
        if payload is None:
            return error_response("SESSION_NOT_FOUND", "Không có phiên này.", 404)
        return {**payload, **(extra or {})}

    @router.post("", **VIEW)
    @router.post("/", **VIEW)
    def create(body: dict = Body(default={})):
        result = tools.create_session(
            players=body.get("players") or [],
            me_player_name=body.get("me_player_name"),
        )
        if not result.ok:
            return fail(result)
        return viewed(result.unwrap()["session_id"])

    @router.get("/active", response_model=ActiveView, response_model_exclude_none=False, responses=ERRORS)
    def active():
        """Mở lại app là tiếp tục phiên đang chơi — hỏi server, không hỏi máy mình."""
        found = repo.active_session()
        if found is None:
            return {"session": None, "scoreboard": None}
        return viewed(found.id)

    @router.get("/{session_id}", **VIEW)
    def get_one(session_id: str):
        return viewed(session_id)

    @router.post("/{session_id}/rounds", **VIEW)
    def record(session_id: str, body: dict = Body(default={})):
        result = tools.record_round(
            session_id,
            entries_of(body.get("entries")),
            client_request_id=body.get("client_request_id"),
            source="manual",
        )
        return fail(result) if not result.ok else viewed(session_id)

    @router.patch("/{session_id}/rounds/{round_id}", **VIEW)
    def update(session_id: str, round_id: str, body: dict = Body(default={})):
        result = tools.update_round(
            session_id, round_id, entries_of(body.get("entries")), source="manual"
        )
        return fail(result) if not result.ok else viewed(session_id)

    @router.delete("/{session_id}/rounds/{round_id}", **VIEW)
    def delete(session_id: str, round_id: str):
        result = tools.undo_round(session_id, round_id, source="manual")
        return fail(result) if not result.ok else viewed(session_id)

    @router.get("/{session_id}/rounds/{round_id}/events", response_model=EventsView, response_model_exclude_none=True, responses=ERRORS)
    def events(session_id: str, round_id: str):
        result = tools.get_round_events(session_id, round_id)
        if not result.ok:
            return fail(result)
        return {"events": [e.dump() for e in result.unwrap()["events"]]}

    @router.post("/{session_id}/undo", response_model=LabeledView, response_model_exclude_none=True, responses=ERRORS)
    def undo(session_id: str):
        result = tools.undo_last(session_id)
        if not result.ok:
            return fail(result)
        return viewed(session_id, {"label": result.unwrap()["label"]})

    @router.post("/{session_id}/redo", response_model=LabeledView, response_model_exclude_none=True, responses=ERRORS)
    def redo(session_id: str):
        result = tools.redo_last(session_id)
        if not result.ok:
            return fail(result)
        return viewed(session_id, {"label": result.unwrap()["label"]})

    @router.get("/{session_id}/undo-state", response_model=UndoState, response_model_exclude_none=False, responses=ERRORS)
    def undo_state(session_id: str):
        """Nút hoàn tác/làm lại phải biết còn gì để làm không, trước khi bấm."""
        result = tools.get_undo_state(session_id)
        return fail(result) if not result.ok else result.unwrap()

    @router.post("/{session_id}/players", **VIEW)
    def add_player(session_id: str, body: dict = Body(default={})):
        result = tools.add_player(session_id, str(body.get("name", "")))
        return fail(result) if not result.ok else viewed(session_id)

    @router.delete("/{session_id}/players/{player_id}", **VIEW)
    def remove_player(session_id: str, player_id: str):
        result = tools.remove_player(session_id, player_id)
        return fail(result) if not result.ok else viewed(session_id)

    @router.patch("/{session_id}/settings", **VIEW)
    def settings(session_id: str, body: dict = Body(default={})):
        result = tools.set_confirm_before_commit(
            session_id, bool(body.get("confirm_before_commit"))
        )
        return fail(result) if not result.ok else viewed(session_id)

    @router.post("/{session_id}/end", **VIEW)
    def end(session_id: str):
        result = tools.end_session(session_id)
        return fail(result) if not result.ok else viewed(session_id)

    return router
