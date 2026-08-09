"""Luật nhà đi được từ màn Cài đặt tới tận prompt (C-030).

Ba chỗ dễ đứt mà test đơn lẻ không bắt được:

1. Đặt luật ở màn Cài đặt (PATCH /settings) có vào đúng chỗ mà tool `set_house_rules`
   ghi vào không.
2. Prompt gửi cho model có THẬT SỰ mang theo luật đó không, hay chỉ có trong CSDL.
3. Bảng hạng lệch số người sau khi thêm/bớt ai đó thì prompt có nói ra không.

Mục 2 và 3 kiểm qua vết `/admin`, vì đó cũng chính là chỗ Done-evidence của thẻ
đọc để chứng minh — kiểm cùng một nguồn thì không có khoảng cách nào để lọt.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api.agent.gemini import house_rules_block, system_prompt
from api.agent.types import ModelReply

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]
BANG_4 = [3, 1, -1, -3]
TU_QUY = {"name": "tứ quý", "points": 5, "paidBy": "each"}


class TestPromptMangTheoLuatNha:
    def test_chua_dat_luat_thi_khong_them_chu_nao(self):
        assert house_rules_block({"playerCount": 4}) == ""

    def test_ke_bang_hang_bang_tu_nguoi_ta_noi_o_ban(self):
        block = house_rules_block({"rankPoints": BANG_4, "playerCount": 4})
        assert "nhất +3" in block
        assert "nhì +1" in block
        assert "bét -3" in block

    def test_ke_thuong_kem_cach_chung(self):
        block = house_rules_block({"bonuses": [TU_QUY], "playerCount": 4})
        assert "tứ quý" in block and "5 điểm" in block
        assert "mỗi người còn lại chung đủ" in block

    def test_bang_lech_so_nguoi_thi_prompt_noi_thang(self):
        """Thêm người giữa phiên: model phải biết để đi hỏi, không gọi tool bừa."""
        block = house_rules_block({"rankPoints": BANG_4, "playerCount": 5})
        assert "CHÚ Ý" in block
        assert "4 người" in block and "có 5" in block

    def test_bang_khop_thi_khong_doa_nguoi_ta(self):
        block = house_rules_block({"rankPoints": BANG_4, "playerCount": 4})
        assert "CHÚ Ý" not in block

    def test_prompt_luon_nhac_thieu_nguoi_la_khong_ghi_duoc(self):
        """Chốt thật nằm ở code; câu này chỉ để agent hỏi TRƯỚC, đỡ một lượt Gemini."""
        prompt = system_prompt({"players": [{"name": "Nam"}]})
        assert "HỎI LẠI" in prompt
        assert "tự cho họ 0 điểm" in prompt


class TestQuaHTTP:
    """Đường thật: đặt luật ở màn Cài đặt rồi nói một câu."""

    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        monkeypatch.delenv("DATABASE_URL", raising=False)
        import importlib

        import api.routes.agent as agent_routes

        async def fake(messages, tools, context):
            return ModelReply(text="Rõ.")

        monkeypatch.setattr(agent_routes, "call_gemini", fake)
        import api.main

        importlib.reload(api.main)
        return TestClient(api.main.app), tmp_path

    def _session(self, c) -> str:
        return c.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": "d1"}
        ).json()["session"]["id"]

    def _prompt_of_last_turn(self, tmp) -> str:
        turns = json.loads((tmp / "traces.json").read_text("utf-8"))
        return turns[-1]["steps"][0]["prompt"]

    def test_dat_luat_o_man_cai_dat_roi_doc_lai_duoc(self, client):
        c, _ = client
        sid = self._session(c)

        response = c.patch(
            f"/api/sessions/{sid}/settings",
            json={"scoring_config": {"rankPoints": BANG_4, "bonuses": [TU_QUY]}},
            headers={"X-Device-Id": "d1"},
        )

        assert response.status_code == 200
        config = response.json()["session"]["scoringConfig"]
        assert config["rankPoints"] == BANG_4
        assert config["bonuses"][0]["name"] == "tứ quý"

    def test_bang_lech_so_nguoi_bi_chan_ngay_o_man_cai_dat(self, client):
        c, _ = client
        sid = self._session(c)

        response = c.patch(
            f"/api/sessions/{sid}/settings",
            json={"scoring_config": {"rankPoints": [3, -3]}},
            headers={"X-Device-Id": "d1"},
        )

        assert response.status_code >= 400
        assert response.json()["error"]["code"] == "RANK_POINTS_MISMATCH"

    def test_dat_luat_khong_lam_mat_tuy_chon_xac_nhan(self, client):
        """Hai tuỳ chọn đi chung một cửa — cửa chung không được nuốt của nhau."""
        c, _ = client
        sid = self._session(c)

        c.patch(
            f"/api/sessions/{sid}/settings",
            json={"confirm_before_commit": False},
            headers={"X-Device-Id": "d1"},
        )
        body = c.patch(
            f"/api/sessions/{sid}/settings",
            json={"scoring_config": {"rankPoints": BANG_4}},
            headers={"X-Device-Id": "d1"},
        ).json()

        assert body["session"]["confirmBeforeCommit"] is False
        assert body["session"]["scoringConfig"]["rankPoints"] == BANG_4

    def test_prompt_that_su_mang_theo_luat_vua_dat(self, client):
        c, tmp = client
        sid = self._session(c)
        c.patch(
            f"/api/sessions/{sid}/settings",
            json={"scoring_config": {"rankPoints": BANG_4, "bonuses": [TU_QUY]}},
            headers={"X-Device-Id": "d1"},
        )

        c.post(
            f"/api/sessions/{sid}/agent",
            json={"text": "luật nhà là gì"},
            headers={"X-Device-Id": "d1"},
        )

        prompt = self._prompt_of_last_turn(tmp)
        assert "Luật nhà của bàn này" in prompt
        assert "nhất +3" in prompt
        assert "tứ quý" in prompt

    def test_them_nguoi_giua_phien_thi_prompt_bao_bang_hang_lech(self, client):
        c, tmp = client
        sid = self._session(c)
        c.patch(
            f"/api/sessions/{sid}/settings",
            json={"scoring_config": {"rankPoints": BANG_4}},
            headers={"X-Device-Id": "d1"},
        )
        c.post(
            f"/api/sessions/{sid}/players",
            json={"name": "Mai"},
            headers={"X-Device-Id": "d1"},
        )

        c.post(
            f"/api/sessions/{sid}/agent",
            json={"text": "Nam nhất"},
            headers={"X-Device-Id": "d1"},
        )

        assert "CHÚ Ý" in self._prompt_of_last_turn(tmp)
