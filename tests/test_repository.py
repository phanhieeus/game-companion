"""Dịch từ server/repository/repository.test.ts + fileRepository.test.ts."""

from __future__ import annotations

import json

import pytest

from api.domain.models import DraftEntry
from api.repository.file import FileSessionRepository
from api.repository.memory import MemorySessionRepository
from api.tools import create_tools

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]
#: Phiên thuộc về một thiết bị (C-019) — `active_session` phải biết hỏi giùm ai.
MAY = "may-1"


def seed(repo) -> str:
    """Một phiên có 1 ván, trả về id."""
    tools = create_tools(repo)
    created = tools.create_session(players=PLAYERS, device_id=MAY)
    sid = created.unwrap()["session_id"]
    ids = [r.playerId for r in created.unwrap()["scoreboard"].rows]
    tools.record_round(
        sid,
        [
            DraftEntry(playerId=ids[0], delta=3),
            DraftEntry(playerId=ids[1], delta=-1),
            DraftEntry(playerId=ids[2], delta=-1),
            DraftEntry(playerId=ids[3], delta=-1),
        ],
        source="manual",
    )
    return sid


@pytest.fixture
def path(tmp_path):
    return tmp_path / "data" / "sessions.json"


class TestValueStore:
    """`get` trả bản sao, `save` lưu bản sao — không chia sẻ tham chiếu."""

    @pytest.mark.parametrize("make", [lambda p: MemorySessionRepository()])
    def test_get_tra_ban_sao(self, make, path):
        repo = make(path)
        sid = seed(repo)
        copy = repo.get(sid)
        copy.rounds = []
        assert len(repo.get(sid).rounds) == 1

    def test_save_luu_ban_sao(self, path):
        repo = MemorySessionRepository()
        sid = seed(repo)
        mine = repo.get(sid)
        repo.save(mine)
        mine.status = "ended"
        assert repo.get(sid).status == "active"

    def test_active_session_tim_phien_dang_choi(self):
        repo = MemorySessionRepository()
        sid = seed(repo)
        assert repo.active_session(MAY).id == sid


class TestFileSongSotQuaKhoiDongLai:
    def test_doc_lai_dung_phien_vua_ghi(self, path):
        sid = seed(FileSessionRepository(path))

        # Tiến trình mới, đối tượng repo mới, cùng file.
        session = FileSessionRepository(path).get(sid)
        assert [p.name for p in session.players] == ["Nam", "Hùng", "Lan", "Tú"]
        assert len(session.rounds) == 1
        assert any(e.delta == 3 for e in session.rounds[0].entries)

    def test_active_session_sau_khi_bat_lai(self, path):
        sid = seed(FileSessionRepository(path))
        assert FileSessionRepository(path).active_session(MAY).id == sid

    def test_xoa_phien_thi_lan_bat_sau_khong_con(self, path):
        repo = FileSessionRepository(path)
        sid = seed(repo)
        repo.delete(sid)
        assert FileSessionRepository(path).get(sid) is None


class TestFileHongThiKhoiDongSach:
    def test_chua_co_file(self, path):
        assert FileSessionRepository(path).list() == []

    def test_file_rach_giua_chung(self, path):
        seed(FileSessionRepository(path))
        path.write_text('[{"id":"s1","play', "utf-8")

        repo = FileSessionRepository(path)
        assert repo.list() == []
        # Và vẫn ghi tiếp được — không kẹt vĩnh viễn ở trạng thái hỏng.
        assert seed(repo)

    def test_dung_json_nhung_sai_kieu(self, path):
        seed(FileSessionRepository(path))
        path.write_text('{"không phải": "mảng"}', "utf-8")
        assert FileSessionRepository(path).list() == []


class TestGhiRaDia:
    def test_file_la_json_doc_duoc_bang_mat(self, path):
        sid = seed(FileSessionRepository(path))
        raw = path.read_text("utf-8")
        assert "Nam" in raw
        assert json.loads(raw)[0]["id"] == sid

    def test_khong_de_lai_file_tam(self, path):
        seed(FileSessionRepository(path))
        assert not path.with_suffix(path.suffix + ".tmp").exists()

    def test_khong_xuat_field_None(self, path):
        """`endedAt: None` phải VẮNG khỏi JSON, cho khớp `field?:` của client."""
        seed(FileSessionRepository(path))
        stored = json.loads(path.read_text("utf-8"))[0]
        assert "endedAt" not in stored
        assert "name" not in stored
