"""Trang quan sát agent (C-023).

Trang này lộ nguyên văn prompt và dữ liệu phiên của người khác, trên một URL
công khai. Nên phần đáng test nhất không phải "hiện đúng không" mà là "ai vào
được".
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from api.agent.types import ModelReply, ToolCall

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]
TOKEN = "chia-khoa-bi-mat"


def _client(tmp_path, monkeypatch, token: str | None):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    if token is None:
        monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    else:
        monkeypatch.setenv("ADMIN_TOKEN", token)

    import api.routes.agent as agent_routes

    async def fake(messages, tools, context):
        return ModelReply(call=ToolCall(name="get_scoreboard", args={}))

    monkeypatch.setattr(agent_routes, "call_gemini", fake)

    import api.main

    importlib.reload(api.main)
    return TestClient(api.main.app, raise_server_exceptions=False)


@pytest.fixture
def open_client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch, TOKEN)


@pytest.fixture
def no_token_client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch, None)


class TestAiVaoDuoc:
    def test_khong_dat_bien_thi_route_KHONG_TON_TAI(self, no_token_client):
        """404 chứ không phải 401.

        Trả 401 là đã thú nhận route có thật, và người dò biết mình gõ đúng cửa.
        """
        for path in ("/api/admin/sessions", "/api/admin/stats"):
            assert no_token_client.get(path).status_code == 404

    def test_sai_token_thi_401_va_khong_lo_gi(self, open_client):
        r = open_client.get("/api/admin/sessions", headers={"X-Admin-Token": "sai"})
        assert r.status_code == 401
        body = r.text
        assert "sessionId" not in body and "prompt" not in body

    def test_thieu_token_thi_401(self, open_client):
        assert open_client.get("/api/admin/sessions").status_code == 401

    def test_dung_token_qua_header(self, open_client):
        r = open_client.get("/api/admin/sessions", headers={"X-Admin-Token": TOKEN})
        assert r.status_code == 200

    def test_dung_token_qua_query(self, open_client):
        """Cho phép `?token=` để dán được URL vào trình duyệt trên điện thoại."""
        assert open_client.get(f"/api/admin/sessions?token={TOKEN}").status_code == 200


class TestNoiDung:
    def _session_with_turn(self, client) -> str:
        sid = client.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": "d1"}
        ).json()["session"]["id"]
        client.post(
            f"/api/sessions/{sid}/agent",
            json={"text": "ai đang dẫn"},
            headers={"X-Device-Id": "d1"},
        )
        return sid

    def test_thay_phien_vua_noi(self, open_client):
        sid = self._session_with_turn(open_client)
        rows = open_client.get(
            "/api/admin/sessions", headers={"X-Admin-Token": TOKEN}
        ).json()["sessions"]

        row = next(r for r in rows if r["sessionId"] == sid)
        assert row["turns"] == 1
        assert row["deviceId"] == "d1"
        assert row["players"] == ["Nam", "Hùng", "Lan", "Tú"]
        assert row["status"] == "active"

    def test_mo_phien_ra_thay_du_chuoi_react(self, open_client):
        sid = self._session_with_turn(open_client)
        turns = open_client.get(
            f"/api/admin/sessions/{sid}/turns", headers={"X-Admin-Token": TOKEN}
        ).json()["turns"]

        assert len(turns) == 1
        turn = turns[0]
        assert turn["text"] == "ai đang dẫn"
        assert turn["steps"][0]["tool"] == "get_scoreboard"
        assert "trợ lý ghi điểm bài" in turn["steps"][0]["prompt"]

    def test_so_lieu_dem_dung(self, open_client):
        for _ in range(3):
            self._session_with_turn(open_client)

        stats = open_client.get(
            "/api/admin/stats", headers={"X-Admin-Token": TOKEN}
        ).json()
        assert stats["turns"] == 3
        assert stats["steps"]["max"] >= 1
        assert stats["latencyMs"]["p50"] >= 0

    def test_bao_so_phien_dang_giu_trong_RAM(self, open_client):
        """Con số này không suy ngược ra được từ vết đã lưu (C-029).

        Kho vết nhớ cả phiên đã tắt từ lâu, RAM thì chỉ giữ phiên chưa bị dọn.
        Không hiện ra đây thì không ai biết server đang ôm bao nhiêu — và đặt
        trần cho một con số chưa từng đo là đoán.
        """
        for _ in range(3):
            self._session_with_turn(open_client)

        stats = open_client.get(
            "/api/admin/stats", headers={"X-Admin-Token": TOKEN}
        ).json()

        assert stats["sessionsInMemory"]["count"] == 3
        assert stats["sessionsInMemory"]["limit"] > 0

    def test_duong_dan_api_khong_co_that_tra_404_json(self, open_client):
        """Route SPA từng nuốt mọi /api/* không tồn tại và trả HTML 200.

        Hai hậu quả: client gọi nhầm endpoint nhận HTML rồi chết lúc parse JSON,
        và người dò /api/admin/* trên máy chủ chưa bật quan sát thấy 200 như thể
        route có thật.
        """
        r = open_client.get("/api/khong-co-that")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "NOT_FOUND"

    def test_phien_khong_co_vet_tra_rong(self, open_client):
        turns = open_client.get(
            "/api/admin/sessions/khong-co/turns", headers={"X-Admin-Token": TOKEN}
        ).json()["turns"]
        assert turns == []
