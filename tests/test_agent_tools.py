"""Dịch từ server/agent/tools.test.ts — danh mục tool và chốt HITL (ADR 12)."""

from __future__ import annotations

import pytest

from api.agent.memory import create_memory
from api.agent.tools import AGENT_TOOLS, tool_by_name, tool_declarations
from api.agent.types import ToolContext
from api.repository.memory import MemorySessionRepository
from api.tools import create_tools

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


class Harness:
    def __init__(self, players=None) -> None:
        self.repo = MemorySessionRepository()
        self.tools = create_tools(self.repo)
        created = self.tools.create_session(players=players or PLAYERS)
        self.session_id = created.unwrap()["session_id"]
        self.memory = create_memory()
        self.orders: list[str] = []

    @property
    def ctx(self) -> ToolContext:
        session = self.repo.get(self.session_id)
        assert session is not None
        return ToolContext(
            session=session,
            tools=self.tools,
            memory=self.memory,
            model=None,  # tool không bao giờ gọi model
            set_round_order=lambda o: self.orders.append(o),
        )

    @property
    def session(self):
        return self.repo.get(self.session_id)

    def run(self, name: str, args: dict | None = None):
        return tool_by_name()[name].run(args or {}, self.ctx)


def entries(*pairs):
    return [{"player": p, "delta": d} for p, d in pairs]


@pytest.fixture
def h() -> Harness:
    return Harness()


class TestDiQuaDungToolLayer:
    def test_chan_van_khong_can_cung_loi_nhu_nhap_tay(self, h: Harness):
        result = h.run("record_round", {"entries": entries(("Nam", 3), ("Hùng", -1))})
        assert result.ok is False
        assert "bằng 0" in result.data["error"]
        assert h.session.rounds == []

    def test_ghi_van_can_thi_vao_bang(self, h: Harness):
        result = h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))},
        )
        assert result.ok and result.changed
        assert result.data["recorded"] is True and result.data["round"] == 1

    def test_xoa_van_qua_agent_van_ghi_nhat_ky(self, h: Harness):
        h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))},
        )
        round_id = h.session.rounds[0].id
        h.run("delete_round", {"round": 1})

        events = h.tools.get_round_events(h.session_id, round_id).unwrap()["events"]
        assert len(events) >= 2
        assert events[-1].source == "voice"

    def test_sua_van_qua_agent(self, h: Harness):
        h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))},
        )
        result = h.run(
            "update_round",
            {
                "round": 1,
                "entries": entries(("Nam", 6), ("Hùng", -2), ("Lan", -2), ("Tú", -2)),
            },
        )
        assert result.ok
        assert any(e.delta == 6 for e in h.session.rounds[0].entries)

    def test_khong_sua_duoc_van_khong_ton_tai(self, h: Harness):
        result = h.run(
            "update_round", {"round": 9, "entries": entries(("Nam", 1), ("Hùng", -1))}
        )
        assert "9" in result.data["error"]


class TestKhopTenKhiNgheNham:
    def test_thieu_chu_van_ra_dung_nguoi(self, h: Harness):
        result = h.run(
            "record_round",
            {"entries": entries(("Hùn", 3), ("Nam", -1), ("Lan", -1), ("Tú", -1))},
        )
        assert result.ok
        hung = next(p for p in h.session.players if p.name == "Hùng")
        entry = next(e for e in h.session.rounds[0].entries if e.playerId == hung.id)
        assert entry.delta == 3

    def test_khong_doan_bua_khi_hai_nguoi_cung_tien_to(self):
        h = Harness(
            [{"name": "Hùng"}, {"name": "Hùnga"}, {"name": "Lan"}, {"name": "Tú"}]
        )
        result = h.run(
            "record_round", {"entries": entries(("Hùn", 3), ("Lan", -1), ("Tú", -2))}
        )
        assert result.ok is False
        assert "Hùn" in result.data["error"]


class TestChotXacNhanKhaiOTool:
    """ADR 12 — model chỉ đề xuất, code quyết định."""

    MUTATING = [
        "record_round",
        "update_round",
        "delete_round",
        "add_player",
        "remove_player",
        "set_confirm",
        "end_session",
        "forget",
    ]
    READONLY = ["get_scoreboard", "get_history", "list_memory", "undo", "redo"]

    @pytest.mark.parametrize("name", MUTATING)
    def test_tool_ghi_phai_hoi(self, h: Harness, name: str):
        """Thêm tool đổi dữ liệu mà quên khai thì test đỏ ngay."""
        tool = tool_by_name()[name]
        assert tool.needs_confirm is not None
        assert tool.needs_confirm({"enabled": True}, h.ctx) is True

    @pytest.mark.parametrize("name", READONLY)
    def test_tool_doc_khong_hoi(self, h: Harness, name: str):
        tool = tool_by_name()[name]
        assert tool.needs_confirm is None or not tool.needs_confirm({}, h.ctx)

    def test_record_round_theo_tuy_chon_nguoi_dung(self, h: Harness):
        tool = tool_by_name()["record_round"]
        assert tool.needs_confirm({}, h.ctx) is True

        h.tools.set_confirm_before_commit(h.session_id, False)
        assert tool.needs_confirm({}, h.ctx) is False

    def test_sua_va_xoa_hoi_ke_ca_khi_da_tat_xac_nhan(self, h: Harness):
        """Tắt xác nhận là để ghi ván cho nhanh, không phải để xóa không hỏi."""
        h.tools.set_confirm_before_commit(h.session_id, False)
        assert tool_by_name()["update_round"].needs_confirm({}, h.ctx) is True
        assert tool_by_name()["delete_round"].needs_confirm({}, h.ctx) is True


class TestTheDeXuat:
    def test_propose_tra_dung_ten_va_diem(self, h: Harness):
        rows = tool_by_name()["record_round"].propose(
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))},
            h.ctx,
        )
        assert len(rows) == 4
        assert next(r for r in rows if r.name == "Nam").delta == 3
        assert sum(r.delta for r in rows) == 0

    def test_tra_none_khi_tham_so_khong_doc_duoc(self, h: Harness):
        tool = tool_by_name()["record_round"]
        assert tool.propose({}, h.ctx) is None
        assert tool.propose({"entries": entries(("Ai đó", 3))}, h.ctx) is None


class TestToolDoc:
    def test_get_scoreboard(self, h: Harness):
        h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -1))},
        )
        rows = h.run("get_scoreboard").data
        assert rows[0] == {"name": "Nam", "total": 3, "rank": 1}

    def test_get_history_moi_nhat_truoc(self, h: Harness):
        for n in (1, 2, 3):
            h.run("record_round", {"entries": entries(("Nam", n), ("Hùng", -n))})
        rounds = h.run("get_history", {"limit": 2}).data
        assert [r["round"] for r in rounds] == [3, 2]


class TestThuTuBang:
    def test_goi_thang_vao_ui_khong_dung_session(self, h: Harness):
        h.run("set_round_order", {"order": "newest-first"})
        assert h.orders == ["newest-first"]

    def test_gia_tri_la_thi_ve_mac_dinh(self, h: Harness):
        h.run("set_round_order", {"order": "lung tung"})
        assert h.orders == ["newest-last"]


class TestKhaiBaoGuiChoGemini:
    def test_moi_tool_co_ten_mo_ta_schema(self):
        for d in tool_declarations():
            assert d["name"]
            assert len(d["description"]) > 10
            assert d["parameters"]["type"] == "object"

    def test_khong_lo_ham_chay_ra_ngoai(self):
        for d in tool_declarations():
            assert sorted(d.keys()) == ["description", "name", "parameters"]

    def test_ten_tool_khong_trung_nhau(self):
        assert len(tool_by_name()) == len(AGENT_TOOLS)


class TestTriNho:
    def test_nho_roi_liet_ke_duoc(self, h: Harness):
        h.run("remember", {"fact": "Nhà này tính 3 điểm cho ù"})
        assert h.run("list_memory").data[0]["text"] == "Nhà này tính 3 điểm cho ù"

    def test_quen_dieu_da_nho(self, h: Harness):
        h.run("remember", {"fact": "Lan chỉ chơi tới 10 giờ"})
        result = h.run("forget", {"fact": "10 giờ"})
        assert result.ok
        assert h.run("list_memory").data == []

    def test_quen_dieu_khong_nho(self, h: Harness):
        assert h.run("forget", {"fact": "gì đó"}).ok is False
