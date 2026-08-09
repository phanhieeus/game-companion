"""Vòng đời của dict phiên-trong-RAM (C-029).

Trước card này `sessions` chỉ có chỗ thêm: không dọn khi phiên kết thúc, không
dọn theo tuổi, không có trần. Tiến trình Render sống rất lâu nên số mục tăng
đơn điệu theo số phiên từng nói chuyện với agent.

Chỗ dễ làm hỏng khi sửa không phải là "có dọn không" mà là "dọn cái nào": bỏ
nhầm phiên đang chờ chốt thì người dùng bấm Ghi và nhận 409 — đề xuất bốc hơi
đúng lúc họ đang quyết. Nên phần lớn test dưới đây kiểm THỨ TỰ BỎ.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from api.agent.types import ModelReply, ToolCall
from api.routes.agent import AgentSession, SessionStore

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]
TOKEN = "chia-khoa-bi-mat"

GHI_VAN = ToolCall(
    name="record_round",
    args={
        "entries": [
            {"player": "Nam", "delta": 3},
            {"player": "Hùng", "delta": -1},
            {"player": "Lan", "delta": -1},
            {"player": "Tú", "delta": -1},
        ]
    },
)


def state(pending: ToolCall | None = None) -> AgentSession:
    return AgentSession(memory=object(), pending=pending)


class TestTranVaThuTuBo:
    """Kiểm thẳng chỗ giữ phiên, không qua HTTP — luật bỏ là thứ đáng soi nhất."""

    def test_duoi_tran_thi_khong_bo_gi(self):
        store = SessionStore(limit=3)
        for i in range(3):
            store.touch(f"s{i}", state)
        assert len(store) == 3
        assert all(f"s{i}" in store for i in range(3))

    def test_qua_tran_thi_bo_muc_it_dung_gan_day_nhat(self):
        store = SessionStore(limit=3)
        for i in range(3):
            store.touch(f"s{i}", state)

        # s0 là cũ nhất, nhưng s1 vừa được dùng lại nên s0 mới là cái phải đi.
        store.touch("s1", state)
        store.touch("s3", state)

        assert len(store) == 3
        assert "s0" not in store
        assert all(s in store for s in ("s1", "s2", "s3"))

    def test_bo_theo_thu_tu_dung_chu_khong_bo_hu_hoa(self):
        """Bỏ ngẫu nhiên thì phiên đang chơi cũng có phần bị bỏ như phiên đã tắt."""
        store = SessionStore(limit=2)
        for i in range(5):
            store.touch(f"s{i}", state)
        assert len(store) == 2
        assert "s3" in store and "s4" in store

    def test_phien_dang_cho_chot_bi_bo_SAU_CUNG(self):
        """Bỏ nó trước thì người dùng bấm Ghi và nhận 409."""
        store = SessionStore(limit=2)
        store.touch("cho-chot", lambda: state(GHI_VAN))
        store.touch("ranh-1", state)
        store.touch("ranh-2", state)
        store.touch("ranh-3", state)

        # `cho-chot` là mục CŨ NHẤT — LRU thuần đã bỏ nó từ lượt thứ ba.
        assert "cho-chot" in store
        assert len(store) == 2

    def test_ca_kho_deu_cho_chot_thi_van_giu_tran(self):
        """Trần vẫn phải là trần: lúc đó bỏ phiên chờ chốt cũ nhất."""
        store = SessionStore(limit=2)
        for i in range(4):
            store.touch(f"s{i}", lambda: state(GHI_VAN))

        assert len(store) == 2
        assert "s0" not in store and "s1" not in store

    def test_quet_bo_phien_khong_con_trong_kho(self):
        store = SessionStore(limit=10)
        for i in range(3):
            store.touch(f"s{i}", state)

        store.sweep(lambda session_id: session_id == "s1")

        assert len(store) == 1 and "s1" in store

    def test_quet_bo_ca_phien_dang_cho_chot(self):
        """Phiên đã bị xoá khỏi kho thì `pending` của nó cũng không chốt được nữa."""
        store = SessionStore(limit=10)
        store.touch("da-xoa", lambda: state(GHI_VAN))
        store.sweep(lambda _session_id: False)
        assert len(store) == 0


def _client(tmp_path, monkeypatch, limit: int):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    monkeypatch.setenv("E2E_RESET", "1")

    import api.routes.agent as agent_routes

    queue: list[ModelReply] = []

    async def fake(messages, tools, context):
        return queue.pop(0) if queue else ModelReply(text="Xong.")

    monkeypatch.setattr(agent_routes, "call_gemini", fake)

    import api.main

    importlib.reload(api.main)
    # Đặt trần thấp để test chạm được vào nó; trần thật (500) đo bằng RAM chứ
    # không đo bằng số test chịu khó gõ.
    agent_routes.SESSIONS.limit = limit
    client = TestClient(api.main.app, raise_server_exceptions=False)
    client.queue = queue  # type: ignore[attr-defined]
    client.store = agent_routes.SESSIONS  # type: ignore[attr-defined]
    client.repo = api.main.repo  # type: ignore[attr-defined]
    return client


@pytest.fixture
def client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch, limit=3)


def new_session(client) -> str:
    return client.post(
        "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": "d1"}
    ).json()["session"]["id"]


def speak(client, session_id: str, text: str = "ai đang dẫn"):
    return client.post(
        f"/api/sessions/{session_id}/agent",
        json={"text": text},
        headers={"X-Device-Id": "d1"},
    )


class TestQuaHTTP:
    def test_noi_nhieu_phien_hon_tran_thi_RAM_dung_o_tran(self, client):
        for _ in range(6):
            speak(client, new_session(client))
        assert len(client.store) == 3

    def test_phien_bi_don_noi_lai_van_chay_binh_thuong(self, client):
        """Mất mục không phải mất ván bài — ván nằm ở kho, mục dựng lại được."""
        first = new_session(client)
        speak(client, first)
        for _ in range(5):
            speak(client, new_session(client))
        assert first not in client.store

        client.queue.append(ModelReply(call=GHI_VAN))
        again = speak(client, first, "Nam ăn ba")
        assert again.status_code == 200
        assert again.json()["outcome"]["type"] == "confirm"

        chot = client.post(f"/api/sessions/{first}/agent/confirm", json={"accepted": True})
        assert chot.status_code == 200
        assert len(chot.json()["session"]["rounds"]) == 1

    def test_phien_dang_cho_chot_khong_bi_bo_truoc_phien_dang_ranh(self, client):
        """Ca hỏng thật: đề xuất bốc hơi giữa lúc người dùng đang quyết."""
        cho_chot = new_session(client)
        client.queue.append(ModelReply(call=GHI_VAN))
        assert speak(client, cho_chot, "Nam ăn ba").json()["outcome"]["type"] == "confirm"

        for _ in range(5):
            speak(client, new_session(client))

        assert cho_chot in client.store
        chot = client.post(
            f"/api/sessions/{cho_chot}/agent/confirm", json={"accepted": True}
        )
        assert chot.status_code == 200, "phiên chờ chốt bị dọn nhầm → người dùng ăn 409"
        assert len(chot.json()["session"]["rounds"]) == 1

    def test_reset_don_sach_dict_nay(self, client):
        """e2e dựa vào reset để mỗi test bắt đầu từ con số không."""
        for _ in range(3):
            speak(client, new_session(client))
        assert len(client.store) > 0

        assert client.post("/api/test/reset").status_code == 200
        stats = client.get("/api/admin/stats", headers={"X-Admin-Token": TOKEN}).json()

        assert stats["sessionsInMemory"]["count"] == 0
        assert len(client.store) == 0

    def test_xoa_mot_phien_thi_RAM_cua_no_cung_di(self, client):
        sid = new_session(client)
        speak(client, sid)
        client.repo.delete(sid)

        assert speak(client, sid).status_code == 404
        assert sid not in client.store
