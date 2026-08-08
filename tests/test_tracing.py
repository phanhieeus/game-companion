"""Ghi vết agent (C-022).

Điều quan trọng nhất ở đây không phải "có ghi không" mà là **ghi có đúng không**:
observation phải là kết quả THẬT của tool, và ghi vết hỏng không được phép làm
hỏng lượt nói.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from api import guardrails as g
from api.agent.types import ModelReply, ToolCall
from api.repository.traces import FileTraceStore
from api.tracing import MAX_TURNS_PER_SESSION, Tracer

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


@pytest.fixture(autouse=True)
def _quiet():
    g._listeners.clear()
    yield
    g._listeners.clear()


@pytest.fixture
def store(tmp_path):
    return FileTraceStore(tmp_path / "traces.json")


def _tracer(store, session="s1", text="Nam ăn 3") -> Tracer:
    return Tracer(
        store, turn_id="t1", session_id=session, device_id="d1",
        at="2026-08-08T10:00:00Z", text=text,
    )


class TestChuoiReAct:
    def test_ghi_dung_thu_tu_nghi_lam_nhin(self, store):
        t = _tracer(store)
        t.begin_step()
        t.set_prompt("PROMPT A")
        t.model_replied(text=None, tool="get_scoreboard", args={}, ms=120)
        t.tool_ran(name="get_scoreboard", result=[{"name": "Nam", "total": 3}], ms=2)
        t.begin_step()
        t.set_prompt("PROMPT B")
        t.model_replied(text="Nam dẫn với 3 điểm.", tool=None, args=None, ms=90)
        t.finish({"type": "final", "text": "Nam dẫn với 3 điểm."})

        turn = store.list("s1")[0]
        assert len(turn["steps"]) == 2
        assert turn["steps"][0]["tool"] == "get_scoreboard"
        assert turn["steps"][0]["prompt"] == "PROMPT A"
        assert turn["steps"][1]["thought"] == "Nam dẫn với 3 điểm."
        assert turn["outcome"] == "final"

    def test_observation_la_ket_qua_that_khong_phai_tom_tat(self, store):
        real = {"recorded": True, "round": 7, "scoreboard": {"rows": []}}
        t = _tracer(store)
        t.begin_step()
        t.model_replied(text=None, tool="record_round", args={"entries": []}, ms=1)
        t.tool_ran(name="record_round", result=real, ms=1)
        t.finish({"type": "final", "text": "xong"})

        assert store.list("s1")[0]["steps"][0]["observation"] == real

    def test_do_thoi_gian_tung_buoc(self, store):
        t = _tracer(store)
        t.begin_step()
        t.model_replied(text="ừ", tool=None, args=None, ms=345)
        t.finish({"type": "final", "text": "ừ"})

        turn = store.list("s1")[0]
        assert turn["steps"][0]["modelMs"] == 345
        assert turn["totalMs"] is not None


class TestGoiKhongTheoThuTu:
    """`resume_agent` chạy tool TRƯỚC khi vào vòng lặp — lúc đó chưa có bước nào.

    E2E bắt được chỗ này: đường chốt gọi `tool_ran` khi `_current` còn None. Ba
    hàm ghi đều phải tự mở bước nếu chưa có, nếu không thì cả lượt chốt sập.
    """

    def test_tool_ran_truoc_khi_mo_buoc(self, store):
        t = _tracer(store)
        t.tool_ran(name="record_round", result={"recorded": True}, ms=3)
        t.finish({"type": "final", "text": "xong"})

        turn = store.list("s1")[0]
        assert len(turn["steps"]) == 1
        assert turn["steps"][0]["tool"] == "record_round"

    def test_model_replied_truoc_khi_mo_buoc(self, store):
        t = _tracer(store)
        t.model_replied(text="ừ", tool=None, args=None, ms=5)
        t.finish({"type": "final", "text": "ừ"})

        assert store.list("s1")[0]["steps"][0]["thought"] == "ừ"

    def test_set_prompt_truoc_khi_mo_buoc(self, store):
        t = _tracer(store)
        t.set_prompt("PROMPT")
        t.finish({"type": "final"})

        assert store.list("s1")[0]["steps"][0]["prompt"] == "PROMPT"


class TestSuKien:
    def test_ghi_lai_lan_guardrail_chan(self, store):
        t = _tracer(store)
        t.guardrail(g.GuardrailHit("rate_limit_minute", "chậm thôi", {"limit": 20}))
        t.finish({"type": "blocked", "message": "chậm thôi"})

        turn = store.list("s1")[0]
        assert turn["guardrails"][0]["name"] == "rate_limit_minute"
        assert turn["guardrails"][0]["detail"]["limit"] == 20

    def test_ghi_lai_chot_hitl(self, store):
        t = _tracer(store)
        t.note("hitl_confirm_required", {"tool": "record_round"})
        t.finish({"type": "confirm", "prompt": "Ghi ván này nhé?"})

        turn = store.list("s1")[0]
        assert turn["guardrails"][0]["name"] == "hitl_confirm_required"
        assert turn["outcome"] == "confirm"


class TestDonDep:
    def test_giu_dung_200_luot_moi_phien(self, store):
        for i in range(MAX_TURNS_PER_SESSION + 20):
            Tracer(store, turn_id=f"t{i}", session_id="s1", device_id="d",
                   at=f"2026-08-08T10:{i:04d}", text=f"câu {i}").finish(
                {"type": "final", "text": "ok"}
            )

        turns = store.list("s1", limit=1000)
        assert len(turns) == MAX_TURNS_PER_SESSION
        # Giữ lượt MỚI, bỏ lượt cũ.
        assert turns[0]["text"] == f"câu {MAX_TURNS_PER_SESSION + 19}"

    def test_don_theo_tung_phien_khong_dung_phien_khac(self, store):
        for i in range(MAX_TURNS_PER_SESSION + 5):
            Tracer(store, turn_id=f"a{i}", session_id="ồn-ào", device_id="d",
                   at=f"2026-08-08T10:{i:04d}", text="x").finish({"type": "final"})
        Tracer(store, turn_id="b1", session_id="im-lặng", device_id="d",
               at="2026-08-08T11:00:00", text="một câu duy nhất").finish(
            {"type": "final"}
        )

        assert len(store.list("im-lặng")) == 1
        assert len(store.list("ồn-ào", limit=1000)) == MAX_TURNS_PER_SESSION


class TestKhongLamHongLuotNoi:
    def test_kho_luu_no_thi_nuot_loi(self):
        class Vo:
            def append(self, turn):
                raise RuntimeError("đĩa đầy")

        t = Tracer(Vo(), turn_id="t", session_id="s", device_id=None,
                   at="2026", text="x")
        t.finish({"type": "final", "text": "vẫn phải chạy tiếp"})  # không được ném

    def test_khong_co_kho_thi_van_chay(self):
        t = Tracer(None, turn_id="t", session_id="s", device_id=None, at="2026", text="x")
        t.begin_step()
        t.finish({"type": "final"})


class TestSoLieu:
    def test_dem_dung_tu_chinh_vet_da_luu(self, store):
        for i, steps in enumerate([1, 2, 2, 5]):
            t = Tracer(store, turn_id=f"t{i}", session_id="s1", device_id="d",
                       at=f"2026-08-08T10:0{i}", text="x")
            for _ in range(steps):
                t.begin_step()
                t.model_replied(text="ừ", tool=None, args=None, ms=100)
            t.finish({"type": "final"})

        stats = store.stats()
        assert stats["turns"] == 4
        assert stats["steps"]["max"] == 5
        assert stats["steps"]["distribution"][2] == 2
        assert stats["outcomes"]["final"] == 4

    def test_dem_ca_lan_guardrail_chan(self, store):
        t = _tracer(store)
        t.guardrail(g.GuardrailHit("rate_limit_minute", "x", {}))
        t.finish({"type": "blocked"})

        assert store.stats()["guardrails"]["rate_limit_minute"] == 1


class TestQuaHTTP:
    @pytest.fixture
    def client(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        monkeypatch.delenv("DATABASE_URL", raising=False)
        import importlib

        import api.routes.agent as agent_routes

        replies = iter(
            [
                ModelReply(call=ToolCall(name="get_scoreboard", args={})),
                ModelReply(text="Cả làng đang hoà."),
            ]
        )

        async def fake(messages, tools, context):
            return next(replies, ModelReply(text="hết"))

        monkeypatch.setattr(agent_routes, "call_gemini", fake)
        import api.main

        importlib.reload(api.main)
        return TestClient(api.main.app), tmp_path

    def test_mot_luot_that_de_lai_vet_du_chuoi(self, client):
        c, tmp = client
        sid = c.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": "d1"}
        ).json()["session"]["id"]

        c.post(
            f"/api/sessions/{sid}/agent",
            json={"text": "ai đang dẫn"},
            headers={"X-Device-Id": "d1"},
        )

        turns = json.loads((tmp / "traces.json").read_text("utf-8"))
        turn = turns[-1]
        assert turn["text"] == "ai đang dẫn"
        assert turn["deviceId"] == "d1"
        assert [s["tool"] for s in turn["steps"]] == ["get_scoreboard", None]
        # Prompt thật đã gửi, không phải chỗ trống.
        assert "trợ lý ghi điểm bài" in turn["steps"][0]["prompt"]
        # Observation là bảng điểm thật.
        assert any(r["name"] == "Nam" for r in turn["steps"][0]["observation"])
        assert turn["outcome"] == "final"

    def test_luot_bi_guardrail_chan_cung_de_lai_vet(self, client):
        c, tmp = client
        sid = c.post(
            "/api/sessions", json={"players": PLAYERS}, headers={"X-Device-Id": "d1"}
        ).json()["session"]["id"]

        c.post(
            f"/api/sessions/{sid}/agent",
            json={"text": "x" * 10_000},
            headers={"X-Device-Id": "d1"},
        )

        turn = json.loads((tmp / "traces.json").read_text("utf-8"))[-1]
        assert turn["outcome"] == "blocked"
        assert turn["guardrails"][0]["name"] == "utterance_too_long"
        assert turn["steps"] == []  # chặn trước khi gọi model
