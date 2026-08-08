"""Dịch từ server/agent/loop.test.ts — vòng ReAct, trần bước, chốt HITL."""

from __future__ import annotations

import pytest

from api.agent.loop import MAX_STEPS, resume_agent, run_agent
from api.agent.memory import create_memory
from api.agent.types import AgentMessage, ModelReply, ToolCall, ToolContext
from api.repository.memory import MemorySessionRepository
from api.tools import create_tools

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


class Harness:
    """Model giả tiêm thẳng vào ctx — vòng lặp không biết HTTP tồn tại, nên
    test cũng không phải giả lập tầng mạng."""

    def __init__(self) -> None:
        self.repo = MemorySessionRepository()
        self.tools = create_tools(self.repo)
        created = self.tools.create_session(players=PLAYERS)
        self.session_id = created.unwrap()["session_id"]
        self.memory = create_memory()
        #: Hội thoại model nhận được ở mỗi lượt — soi vòng observe có đóng không.
        self.sent: list[list[AgentMessage]] = []
        self.calls = 0
        self._replies: list[ModelReply] = []

    def script(self, replies: list[ModelReply]) -> None:
        self._replies = replies
        self.calls = 0

    async def _model(self, messages: list[AgentMessage]) -> ModelReply:
        self.sent.append(list(messages))
        reply = (
            self._replies[self.calls]
            if self.calls < len(self._replies)
            else ModelReply(text="Hết kịch bản.")
        )
        self.calls += 1
        return reply

    @property
    def ctx(self) -> ToolContext:
        # session đọc lại mỗi lần: tool ghi xong là session đổi.
        session = self.repo.get(self.session_id)
        assert session is not None
        return ToolContext(
            session=session, tools=self.tools, memory=self.memory, model=self._model
        )

    @property
    def session(self):
        return self.repo.get(self.session_id)

    def recorded(self):
        return [r for r in self.session.rounds if r.status == "recorded"]


def record(*deltas: tuple[str, int]) -> ModelReply:
    return ModelReply(
        call=ToolCall(
            name="record_round",
            args={"entries": [{"player": p, "delta": d} for p, d in deltas]},
        )
    )


@pytest.fixture
def h() -> Harness:
    return Harness()


class TestVongReAct:
    @pytest.mark.asyncio
    async def test_goi_tool_doc_ket_qua_roi_moi_tra_loi(self, h: Harness):
        h.script(
            [
                ModelReply(call=ToolCall(name="get_scoreboard")),
                ModelReply(text="Cả làng đang hoà 0 hết."),
            ]
        )
        result = await run_agent("ai đang dẫn?", h.ctx)

        assert result.outcome == {"type": "final", "text": "Cả làng đang hoà 0 hết."}
        assert result.steps == 2
        assert h.calls == 2

    @pytest.mark.asyncio
    async def test_ket_qua_tool_co_mat_o_buoc_sau(self, h: Harness):
        """Không có chỗ này thì không phải ReAct, chỉ là gọi tool rời rạc."""
        h.script(
            [ModelReply(call=ToolCall(name="get_scoreboard")), ModelReply(text="xong")]
        )
        await run_agent("ai đang dẫn?", h.ctx)

        second = h.sent[1]
        assert [m.role for m in second] == ["user", "model", "tool"]
        assert any(row["name"] == "Nam" for row in second[-1].result)

    @pytest.mark.asyncio
    async def test_nhieu_buoc_lien_tiep(self, h: Harness):
        h.tools.set_confirm_before_commit(h.session_id, False)
        h.script(
            [
                ModelReply(call=ToolCall(name="get_scoreboard")),
                record(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1)),
                ModelReply(text="Ghi rồi nhé."),
            ]
        )
        result = await run_agent("Nam ăn 3, ba người kia chung 1", h.ctx)

        assert result.steps == 3
        assert result.changed is True
        assert len(h.recorded()) == 1


class TestTranCungSoBuoc:
    """ADR 11 — mỗi bước là một lượt gọi Gemini, free tier đã sập một lần."""

    @pytest.mark.asyncio
    async def test_dung_o_dung_buoc_thu_5(self, h: Harness):
        h.script([ModelReply(call=ToolCall(name="get_scoreboard"))] * 20)
        result = await run_agent("làm gì đó đi", h.ctx)

        assert result.outcome["type"] == "error"
        assert result.outcome["retryable"] is False
        assert result.steps == MAX_STEPS
        # Quan trọng nhất: KHÔNG gọi lần thứ 6. Đây là chỗ quota bị đốt.
        assert h.calls == MAX_STEPS

    @pytest.mark.asyncio
    async def test_noi_that_la_chua_xong(self, h: Harness):
        h.script([ModelReply(call=ToolCall(name="get_scoreboard"))] * 20)
        result = await run_agent("làm gì đó đi", h.ctx)
        assert "chưa làm xong" in result.outcome["message"]


class TestChotHITL:
    @pytest.mark.asyncio
    async def test_gap_tool_can_chot_thi_dung_va_tool_chua_chay(self, h: Harness):
        h.script(
            [
                record(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1)),
                ModelReply(text="không được gọi tới đây"),
            ]
        )
        result = await run_agent("Nam ăn 3", h.ctx)

        assert result.outcome["type"] == "confirm"
        assert len(h.recorded()) == 0
        assert result.changed is False
        # Dừng hẳn: không hỏi model thêm lượt nào trong lúc chờ người.
        assert h.calls == 1

    @pytest.mark.asyncio
    async def test_mang_theo_cac_dong_so(self, h: Harness):
        h.script([record(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))])
        result = await run_agent("Nam ăn 3", h.ctx)

        rows = result.outcome["rows"]
        assert len(rows) == 4
        assert next(r for r in rows if r.name == "Nam").delta == 3

    @pytest.mark.asyncio
    async def test_dong_y_thi_tool_chay(self, h: Harness):
        h.script([record(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))])
        first = await run_agent("Nam ăn 3", h.ctx)

        h.script([ModelReply(text="Ghi rồi.")])
        second = await resume_agent(first.outcome["call"], True, h.ctx)

        assert second.changed is True
        assert len(h.recorded()) == 1

    @pytest.mark.asyncio
    async def test_tu_choi_thi_khong_chay_tool(self, h: Harness):
        h.script([record(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))])
        first = await run_agent("Nam ăn 3", h.ctx)

        h.script([ModelReply(text="không nên gọi")])
        second = await resume_agent(first.outcome["call"], False, h.ctx)

        assert len(h.recorded()) == 0
        assert second.changed is False
        # Từ chối không tốn thêm lượt gọi model nào.
        assert h.calls == 0
        # Nhưng hội thoại phải ghi lại, để lượt sau model không đề xuất y hệt.
        last = h.memory.turns()[-1]
        assert last.role == "tool" and last.name == "record_round"


class TestLoi:
    @pytest.mark.asyncio
    async def test_model_no_thi_thanh_loi_doc_duoc(self, h: Harness):
        async def boom(_messages):
            raise RuntimeError("boom")

        ctx = h.ctx
        ctx.model = boom
        result = await run_agent("Nam ăn 3", ctx)

        assert result.outcome["type"] == "error"
        assert result.outcome["retryable"] is True
        assert "trục trặc" in result.outcome["message"]

    @pytest.mark.asyncio
    async def test_giu_nguyen_co_retryable_cua_model(self, h: Harness):
        h.script([ModelReply(error="Hết quota Gemini hôm nay.", retryable=False)])
        result = await run_agent("Nam ăn 3", h.ctx)

        assert result.outcome["retryable"] is False
        assert result.outcome["message"] == "Hết quota Gemini hôm nay."

    @pytest.mark.asyncio
    async def test_tool_khong_ton_tai_thi_bao_lai_cho_model(self, h: Harness):
        h.script(
            [
                ModelReply(call=ToolCall(name="bay_len_troi")),
                ModelReply(text="Xin lỗi, mình không làm được việc đó."),
            ]
        )
        result = await run_agent("bay lên trời đi", h.ctx)

        assert result.outcome["type"] == "final"
        assert "bay_len_troi" in h.sent[1][-1].result["error"]

    @pytest.mark.asyncio
    async def test_model_khong_noi_gi_thi_hoi_lai(self, h: Harness):
        h.script([ModelReply(text="   ")])
        result = await run_agent("ừm", h.ctx)
        assert result.outcome["type"] == "clarify"


class TestToolTuNoiDuoc:
    @pytest.mark.asyncio
    async def test_undo_tra_cau_noi_luon_khoi_ton_luot_model(self, h: Harness):
        from api.domain.models import DraftEntry

        ids = [p.id for p in h.session.players]
        h.tools.record_round(
            h.session_id,
            [
                DraftEntry(playerId=ids[0], delta=3),
                DraftEntry(playerId=ids[1], delta=-3),
            ],
            source="manual",
        )

        h.script(
            [ModelReply(call=ToolCall(name="undo")), ModelReply(text="không nên gọi")]
        )
        result = await run_agent("hoàn tác đi", h.ctx)

        assert result.outcome["type"] == "final"
        assert h.calls == 1
        assert len(h.recorded()) == 0
