"""Đồ dùng chung cho test.

Bản dịch từ `server/**/*.test.ts` (ADR 16): giữ NGUYÊN từng ca kiểm và từng con
số, để so được hai bản có cùng hành vi không. Không phải viết test mới.
"""

from __future__ import annotations

import pytest

from api.domain.models import DraftEntry
from api.repository.memory import MemorySessionRepository
from api.tools import Tools, create_tools, reset_id_counter

PLAYERS = [{"name": "Nam"}, {"name": "Hùng"}, {"name": "Lan"}, {"name": "Tú"}]


@pytest.fixture(autouse=True)
def _reset_ids():
    reset_id_counter()


class Harness:
    def __init__(self) -> None:
        self.repo = MemorySessionRepository()
        self.tools: Tools = create_tools(self.repo)
        created = self.tools.create_session(players=PLAYERS)
        assert created.ok, "setup failed"
        self.session_id: str = created.unwrap()["session_id"]
        self.ids: list[str] = [
            r.playerId for r in created.unwrap()["scoreboard"].rows
        ]

    def entries(self, *deltas: int) -> list[DraftEntry]:
        """Điểm theo THỨ TỰ người chơi, khỏi phải nhắc id ở mọi test."""
        return [
            DraftEntry(playerId=self.ids[i], delta=d)
            for i, d in enumerate(deltas)
            if d is not None
        ]

    @property
    def session(self):
        return self.repo.get(self.session_id)

    def totals(self) -> dict[str, int]:
        board = self.tools.get_scoreboard(self.session_id).unwrap()
        return {r.name: r.total for r in board.rows}

    def recorded(self):
        return [r for r in self.session.rounds if r.status == "recorded"]


@pytest.fixture
def h() -> Harness:
    return Harness()
