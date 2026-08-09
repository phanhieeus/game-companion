"""Agent chạy hẳn ở server (ADR 13).

Client gửi đúng một câu nói và nhận về kết quả. Nó không biết tool nào tồn tại,
không cầm khai báo schema, và quan trọng nhất: **không bao giờ cầm được quyền
chạy tool**. Lời gọi đang chờ xác nhận nằm ở đây cho tới khi người dùng chốt.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, Body, Header, Request

from ..agent.gemini import call_gemini
from ..agent.loop import resume_agent, run_agent
from ..agent.memory import FactStore, Memory, create_memory
from ..agent.tools import tool_declarations
from ..agent.types import AgentMessage, ToolCall, ToolContext
from ..domain.scoring import compute_scoreboard
from ..guardrails import GuardrailHit, RateLimiter, check_utterance
from ..tracing import Tracer
from ..agent.gemini import system_prompt
from ..repository.base import SessionRepository
from ..repository.turns import InMemoryTurnStore, TurnStore
from ..tools import Tools
from .sessions import ERRORS, error_response
from .schemas import AgentReply, ErrorBody


@dataclass
class AgentSession:
    """Những gì server nhớ giữa hai request của cùng một phiên."""

    memory: Memory
    #: Lời gọi đang chờ người chốt — chốt chặn HITL sống ở đây (ADR 12).
    pending: ToolCall | None = None
    #: Ý định đổi tuỳ chọn hiển thị, gom lại để trả về cho client tự áp.
    #:
    #: Thứ tự bảng là tuỳ chọn của người cầm máy chứ không phải dữ liệu ván bài
    #: (ADR 5) — server không có quyền và cũng không nên giữ nó.
    ui_intents: dict = field(default_factory=dict)
    #: Thiết bị của lượt gần nhất — lượt chốt không mang header nên mượn lại.
    device_id: str | None = None


#: Trần số phiên giữ trong RAM cùng lúc.
#:
#: Con số này ĐO RỒI MỚI ĐẶT (C-029), vì đặt trần cho thứ chưa đo là đoán: đoán
#: cao thì trần vô dụng, đoán thấp thì dọn nhầm phiên người ta đang chơi. Đo
#: bằng RSS trên 2000 mục: một mục vừa mở nặng ~0,8 KB, một mục đầy cửa sổ 12
#: lượt kèm chữ ký suy nghĩ của Gemini nặng ~15 KB. 500 mục vì thế chiếm
#: 0,4–7,7 MB — vặt so với 512 MB của Render, mà vẫn cao hơn nhiều lần số phiên
#: thật sự nói cùng lúc, nên trần chỉ chạm tới rác chứ không chạm tới người chơi.
MAX_SESSIONS_IN_RAM = 500


class SessionStore:
    """Chỗ giữ phiên agent trong RAM — có trần, và có thứ tự bỏ rõ ràng.

    Trước C-029 đây là một dict chỉ có chỗ THÊM: không dọn khi phiên kết thúc,
    không dọn theo tuổi, không có trần. Tiến trình Render sống rất lâu nên số
    mục tăng đơn điệu theo số phiên từng mở miệng nói chuyện với agent — rò
    chậm, nhưng không có điểm dừng.

    Hai luật khi phải bỏ bớt:

    - Bỏ mục ÍT DÙNG GẦN ĐÂY NHẤT. Bỏ ngẫu nhiên thì phiên đang chơi cũng có
      phần bị bỏ y như phiên đã bỏ đi từ hôm qua.
    - Phiên đang chờ chốt (`pending`) bỏ SAU CÙNG. Bỏ nhầm nó thì người dùng bấm
      Ghi và nhận 409: đề xuất bốc hơi ngay giữa lúc họ đang quyết. Mất
      `pending` của một phiên đã im lặng rất lâu thì chấp nhận được; giữ RAM vô
      hạn thì không.

    Bị bỏ không phải là mất dữ liệu: ván bài nằm ở kho phiên, thứ mất chỉ là hội
    thoại trong lượt. Nói lại một câu là mục mới được dựng và mọi thứ chạy tiếp.
    """

    def __init__(self, limit: int = MAX_SESSIONS_IN_RAM) -> None:
        self.limit = limit
        self._items: "OrderedDict[str, AgentSession]" = OrderedDict()

    def __len__(self) -> int:
        return len(self._items)

    def __contains__(self, session_id: str) -> bool:
        return session_id in self._items

    def clear(self) -> None:
        self._items.clear()

    def drop(self, session_id: str) -> None:
        self._items.pop(session_id, None)

    def touch(
        self, session_id: str, make: Callable[[], AgentSession]
    ) -> AgentSession:
        """Lấy mục của phiên, dựng mới nếu chưa có, và đánh dấu là vừa dùng."""
        if session_id not in self._items:
            self._items[session_id] = make()
        self._items.move_to_end(session_id)
        self._trim()
        return self._items[session_id]

    def sweep(self, alive: Callable[[str], bool]) -> None:
        """Bỏ mục của những phiên KHÔNG CÒN trong kho.

        Giữ RAM cho một phiên đã bị xoá là giữ rác thuần tuý — không ai gọi lại
        được nó nữa.

        Đây cũng là đường `/api/test/reset` dọn sạch chỗ này: reset xoá mọi phiên
        khỏi kho, nên lần quét kế tiếp không còn mục nào sống sót. Quét chạy khi
        trang quan sát đọc số liệu, tức là dọn NGAY TRƯỚC khi con số được đọc —
        con số hiện ra không bao giờ đếm phiên đã chết. Chỗ duy nhất còn hở là
        khoảng giữa hai lần đọc, và ở đó rác vẫn bị trần chặn.
        """
        for session_id in [s for s in self._items if not alive(s)]:
            del self._items[session_id]

    def _trim(self) -> None:
        while len(self._items) > self.limit:
            self._items.pop(self._victim())

    def _victim(self) -> str:
        """Mục ít dùng gần đây nhất trong số phiên ĐANG RẢNH.

        Chỉ khi cả kho đều đang chờ chốt mới đụng tới phiên chờ chốt — lúc đó
        chọn cái cũ nhất, vì trần vẫn phải là trần.
        """
        idle = next(
            (s for s, state in self._items.items() if state.pending is None), None
        )
        return idle if idle is not None else next(iter(self._items))


#: Một tiến trình, một chỗ giữ phiên.
def build_agent_router(
    tools: Tools,
    repo: SessionRepository,
    fact_store: FactStore,
    trace_store=None,
    turn_store: TurnStore | None = None,
) -> APIRouter:
    router = APIRouter()
    turns_kho: TurnStore = turn_store or InMemoryTurnStore()
    # `sessions` giờ chỉ giữ thứ KHÔNG cất được: lời gọi đang chờ chốt và mấy ý
    # định UI của lượt vừa rồi. Trí nhớ đã xuống kho (C-027) nên bị dọn khỏi RAM
    # không còn làm agent quên gì nữa — chính điều đó khiến trần của C-029 gần
    # như miễn phí: mất mục chỉ là mất chỗ đệm, không mất ngữ cảnh.
    #
    # Gắn vào ROUTER chứ không để ở mức module: dựng router mới nghĩa là dựng
    # server mới, mà RAM của server mới thì rỗng. Một biến toàn cục sẽ khiến
    # test dựng app nhiều lần thừa hưởng phiên của app trước, và buộc
    # `admin.py` phải import ngược sang đây. Cùng lối với `limiter` ngay dưới.
    sessions = SessionStore()
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
        return sessions.touch(
            session_id,
            lambda: AgentSession(
                memory=create_memory(session_id, fact_store, turns_kho)
            ),
        )

    def purge_if_ended(session_id: str, state: AgentSession) -> None:
        """Phiên vừa kết thúc thì dọn cả hai tầng nhớ.

        Dọn ở ĐÂY chứ không ở chỗ `end_session` chạy, vì phiên kết thúc bằng hai
        đường — tool của agent và nút "kết thúc" gọi thẳng `/end` — mà cả hai
        đều đi qua tool layer chứ không biết kho nhớ tồn tại. Route agent là chỗ
        gần nhất vừa cầm `memory` vừa đọc được trạng thái phiên sau khi lượt
        chạy xong.

        Đổi lại, phiên kết thúc qua `/end` chỉ được dọn ở lần nói tiếp theo (nếu
        có). Đó là rác nằm lại, không phải rò rỉ trí nhớ: phiên đã kết thúc thì
        không ai đọc lại được nữa vì `state_of` luôn khoá theo đúng id đó.
        """
        session = repo.get(session_id)
        if session is None or session.status != "active":
            state.memory.purge()
            sessions.pop(session_id, None)

    def context_for(
        session_id: str, state: AgentSession, tracer: Tracer | None = None
    ) -> ToolContext | None:
        session = repo.get(session_id)
        if session is None:
            # Phiên đã bị xoá khỏi kho thì mục vừa dựng ở `state_of` là rác:
            # không ai gọi lại được nó nữa, giữ chỉ tổ chiếm chỗ của phiên thật.
            sessions.drop(session_id)
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
                # Luật nhà đi CÙNG prompt chứ không nằm trong trí nhớ dài hạn:
                # nó là dữ liệu của phiên, đổi ở màn Cài đặt là lượt sau prompt
                # phải khác ngay. `playerCount` đi kèm để prompt tự phát hiện
                # được bảng hạng đã lệch số người sau khi thêm/bớt ai đó.
                "rankPoints": session.scoringConfig.rankPoints,
                "bonuses": [b.dump() for b in session.scoringConfig.bonuses],
                "playerCount": len(
                    [p for p in session.players if p.status == "active"]
                ),
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

        answer = reply(session_id, state, result)
        purge_if_ended(session_id, state)
        return answer

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

        answer = reply(session_id, state, result)
        purge_if_ended(session_id, state)
        return answer

    router.limiter = limiter  # type: ignore[attr-defined]  # cho test đặt lại
    #: Trang quan sát (C-023) và `/api/test/reset` đều phải với tới kho phiên.
    #: Gắn vào router theo đúng lối `limiter` đã đi, thay vì để một biến toàn cục
    #: cho hai module import chéo nhau.
    router.sessions = sessions  # type: ignore[attr-defined]
    return router
