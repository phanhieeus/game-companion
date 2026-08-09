"""Chỗ cất hội thoại trong lượt, khoá theo phiên (C-027).

Trước card này `turns` chỉ nằm trong `dict` của tiến trình API
(`routes/agent.py`), nên mỗi lần Render khởi động lại là mất sạch — trong khi
nhớ lâu và bảng điểm thì còn nguyên. Người dùng không thấy "app vừa restart",
họ thấy trợ lý đột nhiên không hiểu "còn Lan thì sao?" nữa mà mọi thứ khác vẫn
đủ; nó giống trợ lý tự dưng ngu đi hơn là giống một sự cố.

Lối rẽ file/Postgres giống hệt kho phiên (ADR 14 sửa ở C-017) và kho vết
(C-022): đĩa của Render là tạm thời nên production phải dùng CSDL, còn
`npm run dev` không cần dựng Postgres mới chạy được.

Cả kho ghi TRỌN GÓI cửa sổ hội thoại vào một hàng cho mỗi phiên. Cửa sổ tối đa
12 lượt và luôn đọc/ghi cả cụm (`trim_window` cắt trên cả danh sách), nên tách
mỗi lượt một hàng chỉ thêm việc mà không thêm khả năng nào.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

from psycopg import connect
from psycopg.rows import tuple_row

from ..agent.types import AgentMessage, ToolCall


def encode(message: AgentMessage) -> dict:
    """Một lượt → JSON.

    `thought_signature` PHẢI đi cùng: thiếu nó thì Gemini 3.x từ chối cả request
    (xem `types.ToolCall`). Cất một hội thoại rồi đọc lại mà rơi mất chữ ký thì
    lỗi đó quay lại đúng ở lượt đầu sau khi khởi động lại.
    """
    data: dict = {"role": message.role}
    if message.text is not None:
        data["text"] = message.text
    if message.name is not None:
        data["name"] = message.name
    if message.result is not None:
        data["result"] = message.result
    if message.call is not None:
        data["call"] = {
            "name": message.call.name,
            "args": message.call.args or {},
            "thought_signature": message.call.thought_signature,
        }
    return data


def decode(raw: dict) -> AgentMessage:
    call = raw.get("call")
    return AgentMessage(
        role=raw["role"],
        text=raw.get("text"),
        name=raw.get("name"),
        result=raw.get("result"),
        call=(
            ToolCall(
                name=call["name"],
                args=call.get("args") or {},
                thought_signature=call.get("thought_signature"),
            )
            if call
            else None
        ),
    )


class TurnStore(Protocol):
    """Cổng cất hội thoại — cùng chính sách nuốt lỗi như `FactStore`.

    Đọc/ghi hỏng thì coi như rỗng: quên ngữ cảnh vài lượt còn hơn là cả trợ lý
    không nói được câu nào.
    """

    def read(self, session_id: str) -> list[AgentMessage]: ...
    def write(self, session_id: str, turns: list[AgentMessage]) -> None: ...
    def clear(self, session_id: str) -> None: ...


class InMemoryTurnStore:
    """Không cất gì xuống đâu cả — cho test và cho lúc chưa cấu hình chỗ lưu."""

    def __init__(self) -> None:
        self._by_session: dict[str, list[AgentMessage]] = {}

    def read(self, session_id: str) -> list[AgentMessage]:
        return list(self._by_session.get(session_id, []))

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        self._by_session[session_id] = list(turns)

    def clear(self, session_id: str) -> None:
        self._by_session.pop(session_id, None)


class FileTurnStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _load(self) -> dict[str, list[dict]]:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            return raw if isinstance(raw, dict) else {}
        except Exception:
            return {}

    def _save(self, data: dict[str, list[dict]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Ghi qua file tạm rồi đổi tên: nửa chừng bị giết thì file cũ còn nguyên,
        # chứ không để lại một JSON cụt mà lần đọc sau coi là hỏng.
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        os.replace(temp, self.path)

    def read(self, session_id: str) -> list[AgentMessage]:
        try:
            return [decode(t) for t in self._load().get(session_id, [])]
        except Exception:
            return []

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        data = self._load()
        data[session_id] = [encode(t) for t in turns]
        self._save(data)

    def clear(self, session_id: str) -> None:
        data = self._load()
        if data.pop(session_id, None) is not None:
            self._save(data)


SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_turns (
    session_id TEXT PRIMARY KEY,
    data       JSONB NOT NULL
);
"""


class PgTurnStore:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        with self._conn() as conn:
            conn.execute(SCHEMA)

    def _conn(self):
        return connect(self.dsn, row_factory=tuple_row, autocommit=True)

    def read(self, session_id: str) -> list[AgentMessage]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT data FROM agent_turns WHERE session_id = %s", (session_id,)
            ).fetchone()
        return [decode(t) for t in (row[0] if row else [])]

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_turns (session_id, data) VALUES (%s, %s)
                ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data
                """,
                (session_id, json.dumps([encode(t) for t in turns],
                                        ensure_ascii=False)),
            )

    def clear(self, session_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM agent_turns WHERE session_id = %s", (session_id,)
            )
