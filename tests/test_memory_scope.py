"""Trí nhớ agent thuộc về PHIÊN, và sống cùng phiên (C-027).

Trước card này nhớ lâu dùng chung TOÀN CỤC: luật nhà của bàn này áp sang bàn
khác, và trần 20 điều là trần toàn cục nên nhóm nói nhiều đẩy luật nhóm kia ra
mà không ai được báo. Các test dưới đây dựng lại đúng hai chỗ đó.
"""

from __future__ import annotations

import json

from api.agent.memory import (
    MAX_FACTS,
    FileFactStore,
    InMemoryFactStore,
    create_memory,
)
from api.repository.turns import FileTurnStore, InMemoryTurnStore


def kho_doi(fact_store=None, turn_store=None):
    """Hai kho dùng chung cho nhiều phiên — đúng như production."""
    return fact_store or InMemoryFactStore(), turn_store or InMemoryTurnStore()


class TestPhienMoiKhongThayLuatCuaPhienCu:
    def test_luat_cua_phien_A_khong_ro_sang_phien_B(self):
        facts, turns = kho_doi()
        create_memory("phien-A", facts, turns).remember("Nhà này tính 3 điểm cho ù")

        moi = create_memory("phien-B", facts, turns)
        assert [f.text for f in moi.facts()] == []

    def test_hoi_thoai_cung_khong_ro_sang_phien_khac(self):
        from api.agent.types import AgentMessage

        facts, turns = kho_doi()
        a = create_memory("phien-A", facts, turns)
        a.append_turn(AgentMessage(role="user", text="Lan thắng"))

        assert create_memory("phien-B", facts, turns).turns() == []

    def test_quen_o_phien_nay_khong_dung_toi_phien_kia(self):
        facts, turns = kho_doi()
        a = create_memory("phien-A", facts, turns)
        b = create_memory("phien-B", facts, turns)
        fact_a = a.remember("Ù được 3 điểm")
        b.remember("Ù được 5 điểm")

        a.forget(fact_a.id)
        assert [f.text for f in a.facts()] == []
        assert [f.text for f in b.facts()] == ["Ù được 5 điểm"]


class TestLuatSongQuaCuaSoHoiThoai:
    """Lý do tầng nhớ lâu vẫn tồn tại sau khi mất khả năng sống qua nhiều phiên.

    Trong CÙNG một phiên nó sống qua cửa sổ 12 lượt mà `turns` không sống qua:
    "nhà này tính 3 điểm cho ù" nói ở ván 1 phải còn tác dụng ở ván 30.
    """

    def test_day_luat_o_van_1_van_con_sau_khi_noi_vuot_cua_so(self):
        from api.agent.types import AgentMessage

        facts, turns = kho_doi()
        memory = create_memory("phien-A", facts, turns)
        memory.remember("Nhà này tính 3 điểm cho ù")

        for i in range(40):
            memory.append_turn(AgentMessage(role="user", text=f"ván {i}"))
            memory.append_turn(AgentMessage(role="model", text=f"ghi rồi {i}"))

        assert [f.text for f in memory.facts()] == ["Nhà này tính 3 điểm cho ù"]
        # Hội thoại thì đã bị cắt — đó chính là chỗ nhớ lâu phải gánh.
        assert len(memory.turns()) <= 12


class TestTranLaTranMoiPhien:
    def test_20_facts_la_tran_cua_TUNG_phien(self):
        facts, turns = kho_doi()
        a = create_memory("phien-A", facts, turns)
        b = create_memory("phien-B", facts, turns)

        for i in range(MAX_FACTS + 5):
            a.remember(f"luật A số {i}")
        b.remember("luật B duy nhất")

        assert len(a.facts()) == MAX_FACTS
        # Phiên A nói nhiều KHÔNG được đẩy luật của phiên B ra ngoài.
        assert [f.text for f in b.facts()] == ["luật B duy nhất"]

    def test_12_turns_la_tran_cua_TUNG_phien(self):
        from api.agent.types import AgentMessage

        facts, turns = kho_doi()
        a = create_memory("phien-A", facts, turns)
        b = create_memory("phien-B", facts, turns)

        for i in range(30):
            a.append_turn(AgentMessage(role="user", text=f"A {i}"))
        b.append_turn(AgentMessage(role="user", text="B duy nhất"))

        assert len(a.turns()) <= 12
        assert [t.text for t in b.turns()] == ["B duy nhất"]


class TestKetThucPhienThiDon:
    def test_purge_xoa_ca_hai_tang(self):
        from api.agent.types import AgentMessage

        facts, turns = kho_doi()
        memory = create_memory("phien-A", facts, turns)
        memory.remember("Ù được 3 điểm")
        memory.append_turn(AgentMessage(role="user", text="Lan thắng"))

        memory.purge()

        assert memory.facts() == []
        assert memory.turns() == []
        # Và kho thật sự trống, không phải chỉ đối tượng này quên.
        lai = create_memory("phien-A", facts, turns)
        assert lai.facts() == [] and lai.turns() == []

    def test_don_phien_nay_khong_dung_toi_phien_khac(self):
        facts, turns = kho_doi()
        create_memory("phien-A", facts, turns).remember("luật A")
        create_memory("phien-B", facts, turns).remember("luật B")

        create_memory("phien-A", facts, turns).purge()
        assert [f.text for f in create_memory("phien-B", facts, turns).facts()] == [
            "luật B"
        ]


class TestKhoHongThiCoiNhuRong:
    """Chính sách cũ không đổi: đọc/ghi hỏng thì coi như rỗng, agent vẫn chạy."""

    class KhoNo:
        def read(self, session_id):
            raise RuntimeError("CSDL sập")

        def write(self, session_id, data):
            raise RuntimeError("CSDL sập")

        def clear(self, session_id):
            raise RuntimeError("CSDL sập")

    def test_doc_hong_thi_rong(self):
        memory = create_memory("phien-A", self.KhoNo(), self.KhoNo())
        assert memory.facts() == []
        assert memory.turns() == []

    def test_ghi_hong_thi_van_tra_ve_duoc(self):
        from api.agent.types import AgentMessage

        memory = create_memory("phien-A", self.KhoNo(), self.KhoNo())
        assert memory.remember("Ù được 3 điểm").text == "Ù được 3 điểm"
        memory.append_turn(AgentMessage(role="user", text="Lan thắng"))
        memory.forget("khong-co")
        memory.purge()

    def test_file_hong_thi_rong_chu_khong_no(self, tmp_path):
        duong = tmp_path / "memory.json"
        duong.write_text("{ đây không phải JSON", "utf-8")
        assert FileFactStore(duong).read("phien-A") == []

        duong_turns = tmp_path / "turns.json"
        duong_turns.write_text("[1, 2, 3]", "utf-8")
        assert FileTurnStore(duong_turns).read("phien-A") == []

    def test_file_dinh_dang_cu_dung_chung_thi_coi_nhu_rong(self, tmp_path):
        """Bản cũ ghi thẳng một mảng dùng chung cho mọi phiên.

        Đọc phải nó thì mọi phiên bắt đầu từ trắng — đúng thứ operator đã chốt,
        chứ không phải luật của bàn cũ bỗng áp cho bàn mới.
        """
        duong = tmp_path / "memory.json"
        duong.write_text(
            json.dumps([{"id": "fact_1", "text": "luật toàn cục", "at": "2026-01-01"}]),
            "utf-8",
        )
        assert FileFactStore(duong).read("phien-A") == []


class TestKhoFileCungHanhVi:
    """Bản file phải cư xử y hệt bản RAM — chỉ khác chỗ cất."""

    def test_ghi_roi_doc_lai_bang_doi_tuong_moi(self, tmp_path):
        from api.agent.types import AgentMessage

        facts = FileFactStore(tmp_path / "memory.json")
        turns = FileTurnStore(tmp_path / "turns.json")
        memory = create_memory("phien-A", facts, turns)
        memory.remember("Ù được 3 điểm")
        memory.append_turn(AgentMessage(role="user", text="Lan thắng"))

        lai = create_memory(
            "phien-A",
            FileFactStore(tmp_path / "memory.json"),
            FileTurnStore(tmp_path / "turns.json"),
        )
        assert [f.text for f in lai.facts()] == ["Ù được 3 điểm"]
        assert [t.text for t in lai.turns()] == ["Lan thắng"]

    def test_hai_phien_khong_de_len_nhau_trong_cung_file(self, tmp_path):
        facts = FileFactStore(tmp_path / "memory.json")
        turns = FileTurnStore(tmp_path / "turns.json")
        create_memory("phien-A", facts, turns).remember("luật A")
        create_memory("phien-B", facts, turns).remember("luật B")

        assert [f.text for f in create_memory("phien-A", facts, turns).facts()] == [
            "luật A"
        ]
        assert [f.text for f in create_memory("phien-B", facts, turns).facts()] == [
            "luật B"
        ]
