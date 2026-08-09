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
        # Đủ người nhưng tổng = -1: phải rơi vào đúng lưới zero-sum, không phải
        # lưới thiếu người.
        result = h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -1), ("Tú", -2))},
        )
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
        "record_ranking",
        "set_house_rules",
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
            h.run(
                "record_round",
                {
                    "entries": entries(
                        ("Nam", 3 * n), ("Hùng", -n), ("Lan", -n), ("Tú", -n)
                    )
                },
            )
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


BANG_4 = [3, 1, -1, -3]
TU_QUY = {"name": "tứ quý", "points": 5, "paidBy": "each"}


class TestKhongDuNguoiThiKhongGhi:
    """Chốt bằng CODE, KHÔNG đi qua model.

    Cả lớp này gọi thẳng hàm `run` của tool — không có Gemini, không có prompt,
    không có kịch bản nào. Nó tồn tại để chứng minh chốt không phụ thuộc model
    có ngoan hay không: đổi model, đổi prompt, đổi câu chữ, những ca dưới đây
    vẫn phải đỏ nếu ai gỡ chốt đi.
    """

    def test_record_round_thieu_mot_nguoi_thi_bi_tu_choi(self, h: Harness):
        result = h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -1), ("Lan", -2))},
        )

        assert result.ok is False
        assert "Tú" in result.data["error"]
        assert h.session.rounds == []

    def test_loi_tu_choi_la_loi_nhac_de_hoi_lai(self, h: Harness):
        """Không phải "sai cú pháp" — phải là câu đủ để agent đi hỏi tiếp."""
        result = h.run("record_round", {"entries": entries(("Nam", 0), ("Hùng", 0))})
        assert "Lan, Tú" in result.data["error"]
        assert "Hỏi lại" in result.data["error"]

    def test_van_thieu_nguoi_bi_chan_ngay_ca_khi_tong_da_bang_0(self, h: Harness):
        """Tổng cân KHÔNG chứng minh là đủ người — hai lưới bắt hai thứ khác nhau."""
        result = h.run("record_round", {"entries": entries(("Nam", 3), ("Hùng", -3))})
        assert result.ok is False
        assert h.session.rounds == []

    def test_nguoi_0_diem_van_duoc_tinh_la_da_nhac_ten(self, h: Harness):
        """Nói rõ "Tú không được không mất" khác hẳn với im lặng về Tú."""
        result = h.run(
            "record_round",
            {"entries": entries(("Nam", 3), ("Hùng", -3), ("Lan", 0), ("Tú", 0))},
        )
        assert result.ok

    def test_nguoi_da_roi_phien_khong_bi_doi_diem(self, h: Harness):
        tu = next(p for p in h.session.players if p.name == "Tú")
        h.tools.remove_player(h.session_id, tu.id)

        result = h.run(
            "record_round",
            {"entries": entries(("Nam", 2), ("Hùng", -1), ("Lan", -1))},
        )
        assert result.ok

    def test_record_ranking_cung_chiu_dung_chot_do(self, h: Harness):
        h.tools.update_scoring_config(h.session_id, {"rankPoints": BANG_4})
        result = h.run("record_ranking", {"ranking": ["Nam", "Lan", "Hùng"]})

        assert result.ok is False
        assert "Tú" in result.data["error"]
        assert h.session.rounds == []


class TestGhiTheoLuatNha:
    def test_noi_thu_hang_ra_dung_bon_con_so(self, h: Harness):
        h.tools.update_scoring_config(h.session_id, {"rankPoints": BANG_4})

        result = h.run("record_ranking", {"ranking": ["Nam", "Lan", "Hùng", "Tú"]})

        assert result.ok and result.data["recorded"] is True
        deltas = {
            next(p.name for p in h.session.players if p.id == e.playerId): e.delta
            for e in h.session.rounds[0].entries
        }
        assert deltas == {"Nam": 3, "Lan": 1, "Hùng": -1, "Tú": -3}
        assert sum(deltas.values()) == 0

    def test_the_de_xuat_hien_du_bon_dong_truoc_khi_ghi(self, h: Harness):
        h.tools.update_scoring_config(h.session_id, {"rankPoints": BANG_4})
        rows = tool_by_name()["record_ranking"].propose(
            {"ranking": ["Nam", "Lan", "Hùng", "Tú"]}, h.ctx
        )
        assert len(rows) == 4
        assert sum(r.delta for r in rows) == 0

    def test_an_tu_quy_thi_ba_nguoi_kia_moi_nguoi_chung_du(self, h: Harness):
        h.tools.update_scoring_config(h.session_id, {"bonuses": [TU_QUY]})

        result = h.run("record_ranking", {"bonuses": [{"bonus": "tứ quý", "player": "Nam"}]})

        assert result.ok
        deltas = {
            next(p.name for p in h.session.players if p.id == e.playerId): e.delta
            for e in h.session.rounds[0].entries
        }
        assert deltas == {"Nam": 15, "Hùng": -5, "Lan": -5, "Tú": -5}

    def test_bang_hang_lech_so_nguoi_thi_bao_ro_chu_khong_tinh_bua(self, h: Harness):
        h.tools.update_scoring_config(h.session_id, {"rankPoints": BANG_4})
        h.tools.add_player(h.session_id, "Mai")

        result = h.run(
            "record_ranking", {"ranking": ["Nam", "Hùng", "Lan", "Tú", "Mai"]}
        )

        assert result.ok is False
        assert "4" in result.data["error"] and "5" in result.data["error"]
        assert h.session.rounds == []

    def test_chua_dat_luat_thi_khong_bia_ra_luat(self, h: Harness):
        result = h.run("record_ranking", {"ranking": ["Nam", "Hùng", "Lan", "Tú"]})
        assert result.ok is False
        assert h.session.rounds == []

    def test_zero_sum_van_la_cong_cuoi(self, h: Harness):
        """Bảng lệch lọt vào cấu hình bằng cửa sau thì lưới cuối vẫn bắt."""
        session = h.session
        session.scoringConfig = session.scoringConfig.model_copy(
            update={"rankPoints": [3, 1, -1, -2]}
        )
        h.repo.save(session)

        result = h.run("record_ranking", {"ranking": ["Nam", "Hùng", "Lan", "Tú"]})

        assert result.ok is False
        assert "bằng 0" in result.data["error"]
        assert h.session.rounds == []


class TestDatLuatBangLoi:
    def test_noi_luat_vao_dung_cho_nhu_bam_tay(self, h: Harness):
        """Cùng một `update_scoring_config`, nên phải ra cùng một cấu hình."""
        result = h.run(
            "set_house_rules", {"rankPoints": BANG_4, "bonuses": [TU_QUY]}
        )
        assert result.ok and result.changed
        bang_loi = h.session.scoringConfig

        # Đường của màn Cài đặt: PATCH /settings gọi thẳng hàm này.
        khac = Harness()
        khac.tools.update_scoring_config(
            khac.session_id, {"rankPoints": BANG_4, "bonuses": [TU_QUY]}
        )

        assert bang_loi == khac.session.scoringConfig
        assert bang_loi.rankPoints == BANG_4
        assert bang_loi.bonuses[0].name == "tứ quý"

    def test_dat_bang_lech_so_nguoi_thi_bi_chan(self, h: Harness):
        result = h.run("set_house_rules", {"rankPoints": [3, -3]})
        assert result.ok is False
        assert h.session.scoringConfig.rankPoints is None

    def test_dat_bang_khong_can_thi_bi_chan(self, h: Harness):
        result = h.run("set_house_rules", {"rankPoints": [3, 1, -1, -2]})
        assert result.ok is False
        assert "bằng 0" in result.data["error"]

    def test_cau_hoi_xac_nhan_doc_ra_dung_luat_sap_dat(self, h: Harness):
        prompt = tool_by_name()["set_house_rules"].describe(
            {"rankPoints": BANG_4, "bonuses": [TU_QUY]}, h.ctx
        )
        assert "nhất +3" in prompt and "bét -3" in prompt
        assert "tứ quý" in prompt

    def test_khong_noi_luat_nao_thi_khong_doi_gi(self, h: Harness):
        assert h.run("set_house_rules", {}).ok is False

    def test_dat_thuong_thay_the_danh_sach_cu(self, h: Harness):
        h.run("set_house_rules", {"bonuses": [TU_QUY]})
        h.run("set_house_rules", {"bonuses": [{"name": "ù", "points": 3, "paidBy": "each"}]})

        names = [b.name for b in h.session.scoringConfig.bonuses]
        assert names == ["ù"]

    def test_moi_phien_giu_luat_cua_rieng_no(self, h: Harness):
        """Cấu hình mặc định là một hằng dùng chung — sửa phiên này không được
        chạm vào phiên khác."""
        khac = Harness()
        h.run("set_house_rules", {"bonuses": [TU_QUY]})
        assert khac.session.scoringConfig.bonuses == []


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
