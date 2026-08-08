"""Kho trong RAM — dùng cho test và làm mặc định khi chưa cấu hình chỗ lưu."""

from __future__ import annotations

from ..domain.models import Session


class MemorySessionRepository:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str) -> Session | None:
        stored = self._sessions.get(session_id)
        return stored.model_copy(deep=True) if stored else None

    def save(self, session: Session) -> None:
        # Bản sao SÂU, không giữ tham chiếu của caller — xem base.py.
        self._sessions[session.id] = session.model_copy(deep=True)

    def list(self) -> list[Session]:
        return sorted(
            (s.model_copy(deep=True) for s in self._sessions.values()),
            key=lambda s: s.createdAt,
            reverse=True,
        )

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def active_session(self) -> Session | None:
        return next((s for s in self.list() if s.status == "active"), None)
