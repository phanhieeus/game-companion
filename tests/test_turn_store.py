"""Hội thoại sống qua một lần khởi động lại API (C-027).

Trước card này `turns` nằm trong `dict` của tiến trình, nên redeploy là mất
sạch — trong khi bảng điểm và luật nhà còn nguyên. Người dùng không thấy "app
vừa restart", họ thấy trợ lý đột nhiên không hiểu "còn Lan thì sao?" nữa.

Test ở đây đi hai tầng: mã hoá một lượt không được rơi mất gì, và cả app dựng
lại từ cùng thư mục dữ liệu thì vẫn gửi lên đúng hội thoại cũ.
"""

from __future__ import annotations

import importlib
import json
import os

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.agent.memory import is_well_formed
from api.agent.types import AgentMessage, ModelReply, ToolCall
from api.repository.turns import (
    FileTurnStore,
    InMemoryTurnStore,
    StoredTurn,
    to_messages,
    to_rows,
)

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


class TestMaHoaMotLuot:
    def test_lai_di_lai_ve_khong_mat_gi(self):
        """Vòng cất-rồi-đọc qua `StoredTurn`: cả lượt có `call` lẫn lượt có
        `result`, cả giá trị lồng nhau lẫn `null` nằm bên trong."""
        goc = [
            AgentMessage(role="user", text="Lan thắng 3 điểm"),
            AgentMessage(
                role="model",
                call=ToolCall(
                    name="record_round",
                    args={"entries": [{"player": "Lan", "delta": 3}]},
                    thought_signature="chu-ky-cua-gemini",
                ),
            ),
            AgentMessage(
                role="tool",
                name="record_round",
                result={"ok": True, "rows": [{"name": "Lan", "total": 3}],
                        "ghiChu": None, "ti_le": 1.5},
            ),
            AgentMessage(role="model", text="Ghi rồi."),
        ]
        assert to_messages(to_rows(goc)) == goc

    def test_null_nam_trong_result_khong_bi_nuot(self):
        """`Base.dump()` bỏ field None của MODEL, không được đụng vào ruột
        `result` — bỏ mất một khoá là sửa dữ liệu tool đã trả về."""
        goc = AgentMessage(role="tool", name="x", result={"a": None, "b": [None, 1]})
        assert to_rows([goc])[0]["result"] == {"a": None, "b": [None, 1]}

    def test_giu_thought_signature(self):
        """Thiếu chữ ký là Gemini 3.x từ chối CẢ request (400).

        Cất hội thoại rồi đọc lại mà rơi mất nó thì lỗi ấy quay lại đúng ở lượt
        đầu sau khi khởi động lại.
        """
        goi = AgentMessage(
            role="model", call=ToolCall(name="get_scoreboard", thought_signature="abc")
        )
        assert to_messages(to_rows([goi]))[0].call.thought_signature == "abc"

    def test_kieu_nguyen_thuy_khong_bi_ep_lech(self):
        """`True` không được thành `1`, `2.0` không được thành `2`."""
        goc = AgentMessage(role="tool", name="x", result=[True, 1, 2.0, "3"])
        assert to_rows([goc])[0]["result"] == [True, 1, 2.0, "3"]
        assert to_rows([goc])[0]["result"][0] is True


class TestBatOCuaGhi:
    """Điểm yếu cũ: `result` khai `Any` nên giá trị không JSON hoá được lọt tới
    `json.dumps`, chết ở đó, và bị chính sách nuốt lỗi nuốt mất — phiên ấy âm
    thầm mất cả cửa sổ hội thoại mà không ai biết vì sao."""

    def test_datetime_bi_chan_ngay_tai_cua(self):
        import datetime

        with pytest.raises(ValidationError):
            to_rows([AgentMessage(role="tool", name="x",
                                  result={"at": datetime.datetime.now()})])

    def test_object_thuong_bi_chan_ngay_tai_cua(self):
        class KhongPhaiJson:
            pass

        with pytest.raises(ValidationError):
            to_rows([AgentMessage(role="tool", name="x", result=KhongPhaiJson())])

    def test_args_cua_tool_cung_di_qua_cung_cua(self):
        import datetime

        with pytest.raises(ValidationError):
            to_rows(
                [
                    AgentMessage(
                        role="model",
                        call=ToolCall(name="x", args={"khi": datetime.date.today()}),
                    )
                ]
            )

    @pytest.mark.parametrize("kieu_kho", ["ram", "file"])
    def test_phien_khac_khong_hong_lay(self, kieu_kho, tmp_path):
        """Ghi hỏng phải nổ TRƯỚC khi động vào chỗ cất."""
        import datetime

        kho = (
            InMemoryTurnStore()
            if kieu_kho == "ram"
            else FileTurnStore(tmp_path / "turns.json")
        )
        kho.write("phien-B", [AgentMessage(role="user", text="B vẫn ổn")])
        kho.write("phien-A", [AgentMessage(role="user", text="A lượt cũ")])

        with pytest.raises(ValidationError):
            kho.write(
                "phien-A",
                [
                    AgentMessage(role="user", text="A lượt cũ"),
                    AgentMessage(role="tool", name="x",
                                 result=datetime.datetime.now()),
                ],
            )

        assert [t.text for t in kho.read("phien-B")] == ["B vẫn ổn"]
        # Và phiên A cũng chỉ mất đúng lượt sai, không mất cửa sổ đã cất.
        assert [t.text for t in kho.read("phien-A")] == ["A lượt cũ"]


class TestDocPhaiDuLieuMeo:
    """Chính sách không đổi: đọc hỏng thì coi như rỗng. Pydantic chỉ đổi CHỖ lỗi
    bị phát hiện, không đổi cách xử lý nó."""

    @pytest.mark.parametrize(
        "meo",
        [
            [{"role": "nguoi-la"}],  # role không có thật
            [{"text": "thiếu role"}],  # thiếu field bắt buộc
            [{"role": "model", "call": {"args": {}}}],  # call thiếu tên tool
            ["không phải object"],
            "cả file sai kiểu",
        ],
        ids=["role-la", "thieu-role", "call-thieu-ten", "khong-phai-object", "sai-kieu"],
    )
    def test_file_meo_thi_rong_chu_khong_no(self, meo, tmp_path):
        duong = tmp_path / "turns.json"
        duong.write_text(json.dumps({"phien-A": meo}), "utf-8")
        assert FileTurnStore(duong).read("phien-A") == []

    def test_meo_o_phien_nay_khong_lam_phien_kia_cam(self, tmp_path):
        duong = tmp_path / "turns.json"
        duong.write_text(
            json.dumps(
                {
                    "phien-A": [{"role": "nguoi-la"}],
                    "phien-B": [{"role": "user", "text": "vẫn đọc được"}],
                }
            ),
            "utf-8",
        )
        kho = FileTurnStore(duong)
        assert kho.read("phien-A") == []
        assert [t.text for t in kho.read("phien-B")] == ["vẫn đọc được"]

    def test_hinh_dang_tren_dia_khong_doi(self, tmp_path):
        """Không được tự đẻ ra một migration: đọc đúng thứ bản trước đã ghi.

        Bản trước ghi `thought_signature: null` tường minh; `Base.dump()` bỏ
        field None nên bản này không ghi nữa — nhưng đọc thì vẫn phải nhận cả
        hai dạng.
        """
        duong = tmp_path / "turns.json"
        duong.write_text(
            json.dumps(
                {
                    "phien-A": [
                        {"role": "user", "text": "Lan thắng"},
                        {
                            "role": "model",
                            "call": {"name": "record_round", "args": {},
                                     "thought_signature": None},
                        },
                    ]
                }
            ),
            "utf-8",
        )
        turns = FileTurnStore(duong).read("phien-A")
        assert [t.role for t in turns] == ["user", "model"]
        assert turns[1].call.name == "record_round"
        assert turns[1].call.thought_signature is None

    def test_model_cung_doc_duoc_bang_model_validate(self):
        turn = StoredTurn.model_validate({"role": "user", "text": "xin chào"})
        assert turn.to_message() == AgentMessage(role="user", text="xin chào")


class TestKhoHoiThoai:
    @pytest.fixture(params=["ram", "file"])
    def kho(self, request, tmp_path):
        if request.param == "ram":
            return InMemoryTurnStore()
        return FileTurnStore(tmp_path / "turns.json")

    def test_ghi_roi_doc_lai(self, kho):
        kho.write("phien-A", [AgentMessage(role="user", text="Lan thắng")])
        assert [t.text for t in kho.read("phien-A")] == ["Lan thắng"]

    def test_phien_chua_noi_gi_thi_rong(self, kho):
        assert kho.read("phien-chua-co") == []

    def test_hai_phien_khong_de_len_nhau(self, kho):
        kho.write("phien-A", [AgentMessage(role="user", text="A")])
        kho.write("phien-B", [AgentMessage(role="user", text="B")])
        assert [t.text for t in kho.read("phien-A")] == ["A"]
        assert [t.text for t in kho.read("phien-B")] == ["B"]

    def test_ghi_de_chu_khong_noi_them(self, kho):
        kho.write("phien-A", [AgentMessage(role="user", text="cũ")])
        kho.write("phien-A", [AgentMessage(role="user", text="mới")])
        assert [t.text for t in kho.read("phien-A")] == ["mới"]

    def test_clear_chi_dung_toi_dung_phien(self, kho):
        kho.write("phien-A", [AgentMessage(role="user", text="A")])
        kho.write("phien-B", [AgentMessage(role="user", text="B")])
        kho.clear("phien-A")
        assert kho.read("phien-A") == []
        assert [t.text for t in kho.read("phien-B")] == ["B"]

    def test_clear_phien_khong_co_thi_im_lang(self, kho):
        kho.clear("phien-chua-co")


# ── Qua cả app thật ─────────────────────────────────────────────────────────


def build_client(tmp_path, monkeypatch, ghi_nhan: list):
    """Dựng app trên một thư mục dữ liệu cho trước.

    Gọi lần thứ hai với CÙNG `tmp_path` là dựng lại nguyên app từ cùng chỗ cất —
    đúng thứ xảy ra khi Render redeploy.
    """
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)

    import api.routes.agent as agent_routes

    async def fake(messages, tools, context):
        ghi_nhan.append((list(messages), dict(context)))
        return ModelReply(text="Rồi nhé.")

    monkeypatch.setattr(agent_routes, "call_gemini", fake)

    import api.main

    importlib.reload(api.main)
    return TestClient(api.main.app, raise_server_exceptions=False)


def tao_phien(client) -> str:
    made = client.post("/api/sessions", json={"players": PLAYERS})
    assert made.status_code == 200, made.text
    return made.json()["session"]["id"]


class TestSongQuaKhoiDongLai:
    def test_hoi_thoai_van_con_sau_khi_dung_app_len_lai(self, tmp_path, monkeypatch):
        """Verify: nói 3 lượt tham chiếu ngược → khởi động lại → vẫn hiểu."""
        ghi_nhan: list = []
        client = build_client(tmp_path, monkeypatch, ghi_nhan)
        sid = tao_phien(client)
        for cau in ["Lan thắng 3 điểm", "còn Hùng thì sao", "Nam nữa"]:
            assert client.post(f"/api/sessions/{sid}/agent", json={"text": cau}).status_code == 200

        ghi_nhan.clear()
        lai = build_client(tmp_path, monkeypatch, ghi_nhan)
        assert lai.post(f"/api/sessions/{sid}/agent", json={"text": "còn Tú"}).status_code == 200

        gui_len = ghi_nhan[-1][0]
        cac_cau = [m.text for m in gui_len if m.role == "user"]
        # Ba câu cũ phải còn trong hội thoại gửi lên — đó là thứ làm agent hiểu
        # được "còn Tú" là hỏi về điểm chứ không phải hỏi vu vơ.
        assert "Lan thắng 3 điểm" in cac_cau
        assert "còn Hùng thì sao" in cac_cau
        assert cac_cau[-1] == "còn Tú"

    def test_hoi_thoai_doc_lai_van_dung_hinh_dang_gemini_doi(
        self, tmp_path, monkeypatch
    ):
        """Verify: hội thoại đọc lại từ kho thoả `is_well_formed()`.

        Kiểm bằng test chứ không bằng mắt — một `functionResponse` mồ côi ở lượt
        đầu sau redeploy là 400 và người dùng chẳng làm gì sai.
        """
        ghi_nhan: list = []
        client = build_client(tmp_path, monkeypatch, ghi_nhan)
        sid = tao_phien(client)
        for i in range(6):
            client.post(f"/api/sessions/{sid}/agent", json={"text": f"câu {i}"})

        ghi_nhan.clear()
        lai = build_client(tmp_path, monkeypatch, ghi_nhan)
        lai.post(f"/api/sessions/{sid}/agent", json={"text": "câu tiếp"})

        gui_len = ghi_nhan[-1][0]
        assert is_well_formed(gui_len)
        assert gui_len[0].role == "user"

    def test_luat_nha_khong_ro_sang_phien_moi(self, tmp_path, monkeypatch):
        """Verify: phiên A dạy một luật → phiên MỚI không thấy luật đó.

        Đọc qua `memory` trong prompt context — đúng khối "Những điều bạn đã nhớ
        về nhóm này" mà bằng chứng production sẽ soi trên `/admin`.
        """
        ghi_nhan: list = []
        client = build_client(tmp_path, monkeypatch, ghi_nhan)
        a = tao_phien(client)

        import api.main
        from api.agent.memory import create_memory

        create_memory(a, api.main.fact_store, api.main.turn_store).remember(
            "Nhà này tính 3 điểm cho ù"
        )

        ghi_nhan.clear()
        client.post(f"/api/sessions/{a}/agent", json={"text": "ghi ván"})
        assert ghi_nhan[-1][1]["memory"] == ["Nhà này tính 3 điểm cho ù"]

        b = tao_phien(client)
        ghi_nhan.clear()
        client.post(f"/api/sessions/{b}/agent", json={"text": "ghi ván"})
        assert ghi_nhan[-1][1]["memory"] == []

    def test_ket_thuc_phien_thi_don_ca_hai_tang(self, tmp_path, monkeypatch):
        """Verify: kết thúc phiên → cả facts lẫn turns bị dọn."""
        ghi_nhan: list = []
        client = build_client(tmp_path, monkeypatch, ghi_nhan)
        sid = tao_phien(client)

        import api.main
        from api.agent.memory import create_memory

        create_memory(sid, api.main.fact_store, api.main.turn_store).remember("luật")
        client.post(f"/api/sessions/{sid}/agent", json={"text": "Lan thắng"})

        assert client.post(f"/api/sessions/{sid}/end").status_code == 200
        # Lượt nói tiếp là chỗ route agent nhận ra phiên đã đóng và dọn.
        client.post(f"/api/sessions/{sid}/agent", json={"text": "còn gì không"})

        con_lai = create_memory(sid, api.main.fact_store, api.main.turn_store)
        assert con_lai.facts() == []
        assert con_lai.turns() == []

    def test_kho_hong_thi_agent_van_tra_loi_duoc(self, tmp_path, monkeypatch):
        """Verify: kho hỏng → coi như rỗng, agent vẫn trả lời được.

        Phá đúng kiểu đau nhất: chỗ đáng lẽ là file thì lại là thư mục, nên cả
        đọc lẫn GHI đều nổ. Nếu chính sách nuốt lỗi bị nới ra thì test này 500.
        """
        ghi_nhan: list = []
        client = build_client(tmp_path, monkeypatch, ghi_nhan)
        sid = tao_phien(client)

        for ten in ("memory.json", "turns.json"):
            duong = tmp_path / ten
            if duong.exists():
                duong.unlink()
            duong.mkdir()

        response = client.post(f"/api/sessions/{sid}/agent", json={"text": "Lan thắng"})
        assert response.status_code == 200
        assert response.json()["outcome"]["type"] == "final"
        # Và prompt vẫn dựng được, chỉ là khối trí nhớ trống.
        assert ghi_nhan[-1][1]["memory"] == []


# ── Postgres thật ───────────────────────────────────────────────────────────

DSN = os.environ.get("DATABASE_URL")


@pytest.mark.skipif(not DSN, reason="cần DATABASE_URL trỏ tới một Postgres thật")
class TestTrenPostgres:
    """Cùng ca kiểm, cùng kỳ vọng — chỉ đổi chỗ lưu (như C-017 đã làm).

        DATABASE_URL=postgres://... .venv/bin/python -m pytest tests/test_turn_store.py
    """

    def test_hai_tang_deu_song_qua_ket_noi_moi_va_deu_khoa_theo_phien(self):
        from api.agent.memory import create_memory
        from api.agent.pgmemory import PgFactStore
        from api.repository.turns import PgTurnStore

        a = create_memory("phien-A", PgFactStore(DSN), PgTurnStore(DSN))
        a.purge()
        b = create_memory("phien-B", PgFactStore(DSN), PgTurnStore(DSN))
        b.purge()

        a.remember("Nhà này tính 3 điểm cho ù")
        a.append_turn(AgentMessage(role="user", text="Lan thắng"))

        # Kết nối mới, đối tượng mới — như một tiến trình khác sau redeploy.
        lai = create_memory("phien-A", PgFactStore(DSN), PgTurnStore(DSN))
        assert [f.text for f in lai.facts()] == ["Nhà này tính 3 điểm cho ù"]
        assert [t.text for t in lai.turns()] == ["Lan thắng"]

        khac = create_memory("phien-B", PgFactStore(DSN), PgTurnStore(DSN))
        assert khac.facts() == [] and khac.turns() == []

        lai.purge()
        assert create_memory("phien-A", PgFactStore(DSN), PgTurnStore(DSN)).facts() == []
        assert create_memory("phien-A", PgFactStore(DSN), PgTurnStore(DSN)).turns() == []
