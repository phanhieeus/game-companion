"""Agent chạy hẳn ở server (ADR 13).

Client gửi đúng một câu nói và nhận về kết quả. Nó không biết tool nào tồn tại,
không cầm khai báo schema, và quan trọng nhất: **không bao giờ cầm được quyền
chạy tool**. Lời gọi đang chờ xác nhận nằm ở đây cho tới khi người dùng chốt.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import APIRouter, Body

from ..agent.gemini import call_gemini
from ..agent.loop import resume_agent, run_agent
from ..agent.memory import FactStore, create_memory
from ..agent.tools import tool_declarations
from ..agent.types import AgentMessage, ToolCall, ToolContext
from ..domain.scoring import compute_scoreboard
from ..repository.base import SessionRepository
from ..tools import Tools
from .sessions import error_response


@dataclass
class AgentSession:
    """Những gì server nhớ giữa hai request của cùng một phiên."""

    memory: object
    #: Lời gọi đang chờ người chốt — chốt chặn HITL sống ở đây (ADR 12).
    pending: ToolCall | None = None
    #: Ý định đổi tuỳ chọn hiển thị, gom lại để trả về cho client tự áp.
    #:
    #: Thứ tự bảng là tuỳ chọn của người cầm máy chứ không phải dữ liệu ván bài
    #: (ADR 5) — server không có quyền và cũng không nên giữ nó.
    ui_intents: dict = field(default_factory=dict)


def build_agent_router(
    tools: Tools, repo: SessionRepository, fact_store: FactStore
) -> APIRouter:
    router = APIRouter()
    sessions: dict[str, AgentSession] = {}

    def state_of(session_id: str) -> AgentSession:
        if session_id not in sessions:
            sessions[session_id] = AgentSession(memory=create_memory(fact_store))
        return sessions[session_id]

    def context_for(session_id: str, state: AgentSession) -> ToolContext | None:
        session = repo.get(session_id)
        if session is None:
            return None

        async def model(messages: list[AgentMessage]):
            return await call_gemini(
                messages,
                tool_declarations(),
                {
                    "players": [
                        {"name": p.name}
                        for p in session.players
                        if p.status == "active"
                    ],
                    "mePlayer": next(
                        (p.name for p in session.players if p.id == session.mePlayerId),
                        None,
                    ),
                    "zeroSum": session.scoringConfig.zeroSum,
                    "roundsPlayed": len(
                        [r for r in session.rounds if r.status == "recorded"]
                    ),
                    "confirmBeforeCommit": session.confirmBeforeCommit,
                    "memory": [f.text for f in state.memory.facts()],
                },
            )

        def set_round_order(order: str) -> None:
            state.ui_intents["roundOrder"] = order

        return ToolContext(
            session=session,
            tools=tools,
            memory=state.memory,
            model=model,
            set_round_order=set_round_order,
        )

    def to_wire(outcome: dict) -> dict:
        """Bỏ `call` trước khi gửi đi.

        Bản nội bộ mang theo cả tên tool lẫn `thought_signature` của Gemini.
        Client không cần và KHÔNG NÊN biết: nó chỉ trả lời có/không, còn lời gọi
        thì server giữ. Gửi kèm ra ngoài là mời người ta tự chế request chạy
        tool tuỳ ý.
        """
        return {k: v for k, v in outcome.items() if k != "call"}

    def reply(session_id: str, state: AgentSession, result) -> dict:
        session = repo.get(session_id)
        assert session is not None
        intents = state.ui_intents
        state.ui_intents = {}

        rows = result.outcome.get("rows")
        outcome = to_wire(result.outcome)
        if rows is not None:
            outcome["rows"] = [r.dump() for r in rows]

        return {
            "outcome": outcome,
            "steps": result.steps,
            "session": session.dump(),
            "scoreboard": compute_scoreboard(session).dump(),
            "uiIntents": intents,
        }

    @router.post("/{session_id}/agent")
    async def speak(session_id: str, body: dict = Body(default={})):
        state = state_of(session_id)
        ctx = context_for(session_id, state)
        if ctx is None:
            return error_response("SESSION_NOT_FOUND", "Không có phiên này.", 404)

        text = str(body.get("text") or "").strip()
        if not text:
            return error_response("EMPTY_UTTERANCE", "Chưa nghe được gì.", 400)

        # Câu mới trong lúc còn lời gọi treo = người dùng đổi ý. Bỏ lời gọi cũ,
        # đừng để nó nằm đó rồi chốt nhầm ở lần bấm sau.
        state.pending = None

        result = await run_agent(text, ctx)
        if result.outcome.get("type") == "confirm":
            state.pending = result.outcome["call"]

        return reply(session_id, state, result)

    @router.post("/{session_id}/agent/confirm")
    async def confirm(session_id: str, body: dict = Body(default={})):
        state = state_of(session_id)
        ctx = context_for(session_id, state)
        if ctx is None:
            return error_response("SESSION_NOT_FOUND", "Không có phiên này.", 404)

        call = state.pending
        if call is None:
            # 409 chứ không 500: không có gì đang chờ là chuyện bình thường
            # (bấm hai lần, hoặc tải lại trang giữa chừng), không phải hỏng.
            return error_response(
                "NOTHING_PENDING", "Không có gì đang chờ chốt.", 409
            )

        state.pending = None
        result = await resume_agent(call, bool(body.get("accepted")), ctx)
        if result.outcome.get("type") == "confirm":
            state.pending = result.outcome["call"]

        return reply(session_id, state, result)

    return router
