"""Phiên gắn với thiết bị (C-019, ADR 15).

Trước card này `/active` trả phiên đang chơi TOÀN CỤC: hai người mở app trên hai
máy là rơi vào chung một phiên. Local một người thì không thấy; deploy công khai
rồi thì thấy ngay.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.domain.models import DraftEntry
from api.repository.memory import MemorySessionRepository
from api.tools import create_tools

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]

A = "thiet-bi-a"
B = "thiet-bi-b"


@pytest.fixture
def repo():
    return MemorySessionRepository()


@pytest.fixture
def tools(repo):
    return create_tools(repo)


class TestKhoPhien:
    def test_chi_tra_phien_cua_dung_thiet_bi(self, repo, tools):
        a = tools.create_session(players=PLAYERS, device_id=A).unwrap()["session_id"]
        b = tools.create_session(players=PLAYERS, device_id=B).unwrap()["session_id"]

        assert repo.active_session(A).id == a
        assert repo.active_session(B).id == b

    def test_thieu_thiet_bi_thi_khong_tra_gi(self, repo, tools):
        """Trả phiên gần nhất cho người lạ là đúng lỗi card này sinh ra để sửa."""
        tools.create_session(players=PLAYERS, device_id=A)
        assert repo.active_session(None) is None
        assert repo.active_session("") is None

    def test_thiet_bi_la_khong_thay_phien_nguoi_khac(self, repo, tools):
        tools.create_session(players=PLAYERS, device_id=A)
        assert repo.active_session("thiet-bi-chua-tung-co") is None

    def test_ket_thuc_phien_thi_khong_con_active(self, repo, tools):
        sid = tools.create_session(players=PLAYERS, device_id=A).unwrap()["session_id"]
        tools.end_session(sid)
        assert repo.active_session(A) is None

    def test_thiet_bi_cu_van_giu_phien_khi_thiet_bi_khac_ket_thuc(self, repo, tools):
        a = tools.create_session(players=PLAYERS, device_id=A).unwrap()["session_id"]
        b = tools.create_session(players=PLAYERS, device_id=B).unwrap()["session_id"]

        tools.end_session(b)

        assert repo.active_session(A).id == a
        assert repo.active_session(B) is None

    def test_deviceId_song_qua_luu_va_doc_lai(self, repo, tools):
        sid = tools.create_session(players=PLAYERS, device_id=A).unwrap()["session_id"]
        assert repo.get(sid).deviceId == A

    def test_phien_cu_khong_co_deviceId_thi_khong_thuoc_ve_ai(self, repo, tools):
        """Dữ liệu ghi trước C-019 không có field này — đọc phải chịu được."""
        sid = tools.create_session(players=PLAYERS).unwrap()["session_id"]
        assert repo.get(sid).deviceId is None
        assert repo.active_session(A) is None


class TestQuaHTTP:
    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        monkeypatch.delenv("DATABASE_URL", raising=False)
        import importlib

        import api.main

        importlib.reload(api.main)
        return TestClient(api.main.app)

    def test_hai_thiet_bi_hai_phien_doc_lap(self, client):
        a = client.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": A}
        ).json()["session"]["id"]
        b = client.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": B}
        ).json()["session"]["id"]
        assert a != b

        seen_a = client.get("/api/sessions/active", headers={"X-Device-Id": A}).json()
        seen_b = client.get("/api/sessions/active", headers={"X-Device-Id": B}).json()
        assert seen_a["session"]["id"] == a
        assert seen_b["session"]["id"] == b

    def test_khong_gui_header_thi_active_rong(self, client):
        client.post("/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": A})
        body = client.get("/api/sessions/active").json()
        assert body["session"] is None

    def test_ghi_diem_may_nay_khong_dung_may_kia(self, client):
        a = client.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": A}
        ).json()
        b = client.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": B}
        ).json()

        ids = [p["id"] for p in a["session"]["players"]]
        client.post(
            f"/api/sessions/{a['session']['id']}/rounds",
            json={"entries": [{"playerId": ids[0], "delta": 3},
                              {"playerId": ids[1], "delta": -3}]},
            headers={"X-Device-Id": A},
        )

        still_b = client.get("/api/sessions/active", headers={"X-Device-Id": B}).json()
        assert still_b["session"]["id"] == b["session"]["id"]
        assert still_b["session"]["rounds"] == []
