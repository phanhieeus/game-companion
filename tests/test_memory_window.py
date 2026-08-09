"""Cửa sổ hội thoại không được cắt đôi cặp gọi tool (C-026).

Dựng lại đúng lỗi đã xảy ra trên production: `turns[-12:]` cắt ngang giữa
`functionCall` và `functionResponse`, để lại một response mồ côi ở đầu, và
Gemini từ chối cả request với 400.
"""

from __future__ import annotations

import pytest

from api.agent.memory import MAX_TURNS, create_memory, is_well_formed, trim_window
from api.agent.types import AgentMessage, ToolCall
from api.repository.turns import InMemoryTurnStore


def user(text: str) -> AgentMessage:
    return AgentMessage(role="user", text=text)


def call(name: str = "get_scoreboard") -> AgentMessage:
    return AgentMessage(role="model", call=ToolCall(name=name, args={}))


def obs(name: str = "get_scoreboard") -> AgentMessage:
    return AgentMessage(role="tool", name=name, result=[{"name": "Nam"}])


def says(text: str) -> AgentMessage:
    return AgentMessage(role="model", text=text)


def one_turn(i: int) -> list[AgentMessage]:
    """Một lượt đầy đủ có gọi tool: hỏi → gọi → kết quả → trả lời."""
    return [user(f"câu {i}"), call(), obs(), says(f"đáp {i}")]


class TestHinhDang:
    def test_chuoi_dung_thi_hop_le(self):
        assert is_well_formed(one_turn(1))

    def test_tool_mo_coi_la_sai(self):
        """Đây chính là thứ Gemini trả 400."""
        assert not is_well_formed([obs(), says("đáp")])

    def test_tool_khong_dung_sau_call_la_sai(self):
        assert not is_well_formed([user("x"), says("y"), obs()])

    def test_call_dung_sau_model_la_sai(self):
        assert not is_well_formed([user("x"), says("y"), call()])

    def test_call_sau_tool_la_hop_le(self):
        # Vòng ReAct nhiều bước: gọi → kết quả → gọi tiếp.
        assert is_well_formed([user("x"), call(), obs(), call(), obs()])


class TestCatCuaSo:
    def test_hoi_thoai_ngan_giu_nguyen(self):
        turns = one_turn(1)
        assert trim_window(turns) == turns

    def test_khong_bao_gio_bat_dau_bang_tool(self):
        turns = [t for i in range(10) for t in one_turn(i)]
        assert trim_window(turns)[0].role == "user"

    @pytest.mark.parametrize("length", range(1, 61))
    def test_moi_do_dai_deu_cho_cua_so_hop_le(self, length):
        """Cắt ở BẤT KỲ đâu cũng phải ra hội thoại Gemini nhận."""
        flat = [t for i in range(20) for t in one_turn(i)][:length]
        window = trim_window(flat)
        assert is_well_formed(window), f"độ dài {length} cho cửa sổ sai hình dạng"
        assert not window or window[0].role == "user"

    def test_ton_trong_han_muc(self):
        turns = [t for i in range(20) for t in one_turn(i)]
        assert len(trim_window(turns)) <= MAX_TURNS

    def test_chuoi_tool_dai_hon_ca_cua_so(self):
        """Thà trả về trống còn hơn gửi lên thứ chắc chắn bị từ chối."""
        turns = [user("bắt đầu")] + [t for _ in range(MAX_TURNS + 5) for t in (call(), obs())]
        window = trim_window(turns)
        assert is_well_formed(window)


class TestQuaMemory:
    def test_dung_kich_ban_gay_loi_tren_production(self):
        """30 lượt liên tiếp có gọi tool — kịch bản đã sinh ra 11 lần lỗi 400."""
        memory = create_memory()
        for i in range(30):
            for message in one_turn(i):
                memory.append_turn(message)
                # Sau MỖI lần thêm, hội thoại phải sẵn sàng gửi đi được: vòng
                # ReAct gọi model ở giữa lượt, không đợi lượt xong.
                assert is_well_formed(memory.turns())
                assert not memory.turns() or memory.turns()[0].role == "user"

    def test_van_giu_du_ngu_canh_de_hieu_cau_tham_chieu_nguoc(self):
        """Cắt an toàn không được làm agent quên sạch — còn ≥ 1 lượt trọn vẹn."""
        memory = create_memory()
        for i in range(10):
            for message in one_turn(i):
                memory.append_turn(message)

        turns = memory.turns()
        assert len(turns) >= 4
        assert any(t.role == "tool" for t in turns)


class TestDocLaiTuKho:
    """C-027 đưa hội thoại xuống kho, nên mép trái phải hợp lệ cả khi ĐỌC LẠI.

    Trước đây `turns` chỉ sống trong RAM nên chỗ duy nhất cắt sai là lúc ghi.
    Giờ danh sách có thể tới từ một tiến trình khác, và một `functionResponse`
    mồ côi sẽ mồ côi ngay ở lượt ĐẦU sau khi khởi động lại — lỗi 400 của C-026
    quay lại ở dạng khó lần hơn vì không cần nói tới 12 lượt mới hiện ra.
    """

    def test_doc_lai_sau_khi_khoi_dong_lai_van_hop_le(self):
        kho = InMemoryTurnStore()
        memory = create_memory("phien-1", turn_store=kho)
        for i in range(30):
            for message in one_turn(i):
                memory.append_turn(message)

        # Tiến trình mới, cùng kho: đúng thứ xảy ra sau redeploy.
        sau_restart = create_memory("phien-1", turn_store=kho)
        assert is_well_formed(sau_restart.turns())
        assert sau_restart.turns()[0].role == "user"
        assert len(sau_restart.turns()) <= MAX_TURNS

    def test_kho_giu_cua_so_mo_coi_thi_cat_lai_khi_doc(self):
        """Bản ghi cũ/hỏng không được biến thành request Gemini từ chối."""
        kho = InMemoryTurnStore()
        kho.write("phien-1", [obs(), says("đáp"), user("hỏi tiếp"), says("đáp 2")])

        turns = create_memory("phien-1", turn_store=kho).turns()
        assert is_well_formed(turns)
        assert turns and turns[0].role == "user"

    def test_kho_meo_o_giua_thi_coi_nhu_rong(self):
        """`trim_window` chỉ sửa được mép trái; méo ở giữa thì thà bắt đầu lại."""
        kho = InMemoryTurnStore()
        kho.write("phien-1", [user("hỏi"), says("đáp"), obs()])
        assert create_memory("phien-1", turn_store=kho).turns() == []

    def test_noi_tiep_sau_khi_khoi_dong_lai_khong_lam_hong_hinh_dang(self):
        kho = InMemoryTurnStore()
        for i in range(20):
            memory = create_memory("phien-1", turn_store=kho)
            for message in one_turn(i):
                memory.append_turn(message)
                assert is_well_formed(create_memory("phien-1", turn_store=kho).turns())
