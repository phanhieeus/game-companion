"""Agent chạy hẳn ở server (ADR 13).

Client gửi đúng một câu nói và nhận về kết quả. Nó không biết tool nào tồn tại,
không cầm khai báo schema, và quan trọng nhất: **không bao giờ cầm được quyền
chạy tool**. Lời gọi đang chờ xác nhận nằm ở đây cho tới khi người dùng chốt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Body, Header, Request

from ..agent.gemini import call_gemini
from ..agent.loop import resume_agent, run_agent
from ..agent.memory import FactStore, create_memory
from ..agent.tools import tool_declarations
from ..agent.types import AgentMessage, ToolCall, ToolContext
from ..domain.scoring import compute_scoreboard
from ..guardrails import GuardrailHit, RateLimiter, check_utterance
from ..tracing import Tracer
from ..agent.gemini import system_prompt
from ..repository.base import SessionRepository
from ..tools import Tools
from .sessions import ERRORS, error_response
from .schemas import AgentReply, ErrorBody


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
    #: Thiết bị của lượt gần nhất — lượt chốt không mang header nên mượn lại.
    device_id: str | None = None


def build_agent_router(
    tools: Tools,
    repo: SessionRepository,
    fact_store: FactStore,
    trace_store=None,
) -> APIRouter:
    router = APIRouter()
    sessions: dict[str, AgentSession] = {}
    # Mỗi lượt tiêu MỘT lượt gọi Gemini bằng key của operator, trên một URL công
    # khai. Không có lớp này thì ai biết địa chỉ cũng đốt sạch quota (C-021).
    limiter = RateLimiter()

    def new_tracer(session_id: str, device_id: str | None, text: str) -> Tracer:
        return Tracer(
            trace_store,
            turn_id=f"turn_{uuid4().hex[:12]}",
            session_id=session_id,
            device_id=device_id,
            at=datetime.now(timezone.utc).isoformat(),
            text=text,
        )

    def _blocked(tracer: Tracer, hit: GuardrailHit, outcome: str) -> None:
        """Chặn cũng là một lượt — phải nằm trong vết, nếu không thì người dùng
        kêu 'app không nhận' mà admin nhìn log thấy trống trơn."""
        tracer.guardrail(hit)
        tracer.finish({"type": "blocked", "message": hit.message})

    def rate_key(request: Request, device_id: str | None) -> str:
        """Khoá theo thiết bị, lùi về IP khi không có header.

        Thiết bị dễ giả hơn IP, nhưng ghép cả hai thì một người đổi `deviceId`
        liên tục vẫn bị IP chặn, còn cả nhà dùng chung IP thì không chặn nhầm
        nhau nhờ thiết bị.
        """
        ip = request.client.host if request.client else "?"
        return f"{device_id or 'khong-thiet-bi'}|{ip}"

    def state_of(session_id: str) -> AgentSession:
        if session_id not in sessions:
            sessions[session_id] = AgentSession(memory=create_memory(fact_store))
        return sessions[session_id]

    def context_for(
        session_id: str, state: AgentSession, tracer: Tracer | None = None
    ) -> ToolContext | None:
        session = repo.get(session_id)
        if session is None:
            return None

        async def model(messages: list[AgentMessage]):
            prompt_context = {
                "players": [
                    {"name": p.name} for p in session.players if p.status == "active"
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
            }
            # Prompt đổi theo roster và trí nhớ nên không suy ngược được — chép
            # đúng bản đã gửi vào vết (C-022).
            ctx.last_prompt = system_prompt(prompt_context)
            if ctx.tracer:
                ctx.tracer.set_prompt(ctx.last_prompt)
            return await call_gemini(messages, tool_declarations(), prompt_context)

        def set_round_order(order: str) -> None:
            state.ui_intents["roundOrder"] = order

        ctx = ToolContext(
            session=session,
            tools=tools,
            memory=state.memory,
            model=model,
            set_round_order=set_round_order,
            tracer=tracer,
        )
        return ctx

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

    @router.post(
        "/{session_id}/agent",
        response_model=AgentReply,
        response_model_exclude_none=True,
        responses=ERRORS,
    )
    async def speak(
        session_id: str,
        request: Request,
        body: dict = Body(default={}),
        x_device_id: str | None = Header(default=None),
    ):
        state = state_of(session_id)
        ctx = context_for(session_id, state, None)
        if ctx is None:
            return error_response("SESSION_NOT_FOUND", "Không có phiên này.", 404)

        text = str(body.get("text") or "").strip()
        if not text:
            return error_response("EMPTY_UTTERANCE", "Chưa nghe được gì.", 400)

        tracer = new_tracer(session_id, x_device_id, text)

        # Chặn TRƯỚC khi gọi model: câu 10k ký tự không được tốn lượt Gemini nào.
        too_long = check_utterance(text)
        if too_long:
            _blocked(tracer, too_long, "utterance_too_long")
            return error_response("UTTERANCE_TOO_LONG", too_long.message, 400)

        limited = limiter.check(rate_key(request, x_device_id))
        if limited:
            _blocked(tracer, limited, "rate_limited")
            return error_response("RATE_LIMITED", limited.message, 429)

        # Câu mới trong lúc còn lời gọi treo = người dùng đổi ý. Bỏ lời gọi cũ,
        # đừng để nó nằm đó rồi chốt nhầm ở lần bấm sau.
        state.pending = None
        state.device_id = x_device_id

        ctx.tracer = tracer
        result = await run_agent(text, ctx)
        tracer.finish(result.outcome)
        if result.outcome.get("type") == "confirm":
            state.pending = result.outcome["call"]

        return reply(session_id, state, result)

    @router.post(
        "/{session_id}/agent/confirm",
        response_model=AgentReply,
        response_model_exclude_none=True,
        # 409 khi không có gì đang chờ chốt — chuyện bình thường, không phải hỏng.
        responses={**ERRORS, 409: {"model": ErrorBody}},
    )
    async def confirm(session_id: str, body: dict = Body(default={})):
        """KHÔNG tính vào hạn mức — cố ý.

        Chốt là NỬA SAU của một lượt người dùng đã trả giá ở `/agent`. Chặn nó
        thì người dùng kẹt giữa chừng: đề xuất treo trên màn hình mà bấm gì cũng
        không được, và cách thoát duy nhất là tải lại trang.

        Không sợ bị lạm dụng: chốt cần một lời gọi đang chờ, mà lời gọi đó chỉ
        sinh ra từ `/agent` — nơi đã có hạn mức. Không có gì chờ thì trả 409
        ngay, không tốn lượt Gemini nào.
        """
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
        tracer = new_tracer(
            session_id,
            state.device_id,
            f"[chốt: {'đồng ý' if body.get('accepted') else 'bỏ qua'}] {call.name}",
        )
        ctx.tracer = tracer
        result = await resume_agent(call, bool(body.get("accepted")), ctx)
        tracer.finish(result.outcome)
        if result.outcome.get("type") == "confirm":
            state.pending = result.outcome["call"]

        return reply(session_id, state, result)

    router.limiter = limiter  # type: ignore[attr-defined]  # cho test đặt lại
    return router
