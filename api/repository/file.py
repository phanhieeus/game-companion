"""Lưu phiên ra một file JSON trên đĩa (ADR 14).

Một máy, một người ghi, vài chục phiên — ghi nguyên khối là đủ, và file đọc được
bằng mắt khi cần soi. Đổi sang CSDL sau chỉ phải viết thêm một bản của Protocol
này, không đụng scoring hay tool layer (decision 0001).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ..domain.models import Session


class FileSessionRepository:
    def __init__(self, path: str | Path = "data/sessions.json") -> None:
        self.path = Path(path)
        self._sessions: dict[str, Session] = {}
        self._load()

    def _load(self) -> None:
        """File hỏng thì khởi động sạch chứ không sập.

        Đây là dữ liệu ván bài của một buổi chơi, không phải sổ sách ngân hàng.
        Máy chủ không lên được vì một file JSON lỗi là hỏng nặng hơn nhiều so
        với mất lịch sử — mà mất thì người dùng thấy ngay và nhập lại được.
        """
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            if not isinstance(raw, list):
                return
            for item in raw:
                session = Session.model_validate(item)
                self._sessions[session.id] = session
        except Exception:
            # Chưa có file (lần chạy đầu), file rách, hoặc sai hình dạng.
            pass

    def _flush(self) -> None:
        """Ghi ra file tạm rồi đổi tên đè lên.

        `os.replace` trong cùng một filesystem là thao tác nguyên tử, nên tắt
        máy giữa chừng thì file cũ vẫn còn nguyên. Ghi thẳng đè lên thì có một
        khoảnh khắc file chỉ có một nửa nội dung — mất sạch lịch sử vì một lần
        Ctrl-C không đúng lúc.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            [s.dump() for s in self._sessions.values()], ensure_ascii=False, indent=2
        )
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(payload, "utf-8")
        os.replace(temp, self.path)

    def get(self, session_id: str) -> Session | None:
        stored = self._sessions.get(session_id)
        return stored.model_copy(deep=True) if stored else None

    def save(self, session: Session) -> None:
        self._sessions[session.id] = session.model_copy(deep=True)
        self._flush()

    def list(self) -> list[Session]:
        return sorted(
            (s.model_copy(deep=True) for s in self._sessions.values()),
            key=lambda s: s.createdAt,
            reverse=True,
        )

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self._flush()

    def active_session(self) -> Session | None:
        return next((s for s in self.list() if s.status == "active"), None)
