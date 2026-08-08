"""Repository tách khỏi logic tính điểm (decision 0001).

Đây là VALUE STORE: `get()` trả BẢN SAO, `save()` lưu BẢN SAO. Không bao giờ
chia sẻ tham chiếu với caller. Tool layer sửa session tại chỗ, nên nếu chia sẻ
tham chiếu thì một thao tác hỏng giữa chừng vẫn để lại dấu vết trong kho — và
`get()` sau đó trả về đúng object đang dở dang.
"""

from __future__ import annotations

from typing import Protocol

from ..domain.models import Session


class SessionRepository(Protocol):
    def get(self, session_id: str) -> Session | None:
        """Trả về bản sao — sửa nó không ảnh hưởng dữ liệu đã lưu."""

    def save(self, session: Session) -> None:
        """Lưu bản sao — giữ lại tham chiếu của caller là sai."""

    def list(self) -> list[Session]: ...

    def delete(self, session_id: str) -> None: ...

    def active_session(self) -> Session | None:
        """Phiên đang chơi gần nhất — để mở lại app là tiếp tục được."""
