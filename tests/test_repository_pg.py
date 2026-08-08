"""Bộ test của kho file, chạy lại nguyên vẹn cho Postgres (C-017).

Cùng ca kiểm, cùng kỳ vọng — chỉ đổi chỗ lưu. Bỏ qua khi không có
`DATABASE_URL`: đây là test cần CSDL thật, không giả lập được cho ra hồn.

    DATABASE_URL=postgres://... .venv/bin/python -m pytest tests/test_repository_pg.py
"""

from __future__ import annotations

import os

import pytest

from api.domain.models import DraftEntry
from api.tools import create_tools

DSN = os.environ.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DSN, reason="cần DATABASE_URL trỏ tới một Postgres thật"
)

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


def seed(repo) -> str:
    tools = create_tools(repo)
    created = tools.create_session(players=PLAYERS)
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
def repo():
    from api.repository.postgres import PgSessionRepository

    r = PgSessionRepository(DSN)
    for s in r.list():
        r.delete(s.id)
    yield r
    for s in r.list():
        r.delete(s.id)


def test_doc_lai_dung_phien_vua_ghi(repo):
    from api.repository.postgres import PgSessionRepository

    sid = seed(repo)
    # Kết nối mới, đối tượng repo mới — như một tiến trình khác.
    session = PgSessionRepository(DSN).get(sid)
    assert [p.name for p in session.players] == ["Nam", "Hùng", "Lan", "Tú"]
    assert len(session.rounds) == 1
    assert any(e.delta == 3 for e in session.rounds[0].entries)


def test_active_session(repo):
    sid = seed(repo)
    assert repo.active_session().id == sid


def test_phien_da_ket_thuc_khong_con_la_active(repo):
    sid = seed(repo)
    create_tools(repo).end_session(sid)
    assert repo.active_session() is None


def test_xoa_phien(repo):
    sid = seed(repo)
    repo.delete(sid)
    assert repo.get(sid) is None


def test_get_tra_ban_sao(repo):
    sid = seed(repo)
    copy = repo.get(sid)
    copy.rounds = []
    assert len(repo.get(sid).rounds) == 1


def test_phien_khong_ton_tai(repo):
    assert repo.get("khong-co") is None


def test_ghi_de_dung_hang_khong_tao_hang_moi(repo):
    sid = seed(repo)
    create_tools(repo).undo_last(sid)
    assert len([s for s in repo.list() if s.id == sid]) == 1


def test_nho_lau_song_qua_ket_noi_moi(repo):
    from api.agent.pgmemory import PgFactStore
    from api.agent.memory import create_memory

    store = PgFactStore(DSN)
    store.write([])
    create_memory(store).remember("Nhà này tính 3 điểm cho ù")

    again = create_memory(PgFactStore(DSN))
    assert [f.text for f in again.facts()] == ["Nhà này tính 3 điểm cho ù"]
    PgFactStore(DSN).write([])
