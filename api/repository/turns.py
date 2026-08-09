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

Hình dạng một lượt do `StoredTurn` giữ, chứ không bốc field bằng tay — cùng lý
do `domain/models.py` đã nêu cho cả repo.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal, Protocol

from psycopg import connect
from psycopg.rows import tuple_row
from typing_extensions import TypeAliasType

from ..agent.types import AgentMessage, ToolCall
from ..domain.models import Base

#: Đúng những gì JSON diễn tả được, không hơn.
#:
#: `AgentMessage.result` trong bộ nhớ khai là `Any` vì tool trả về gì cũng được.
#: Nhưng ở CỬA GHI thì `Any` là một lời hứa suông: một `datetime` hay một object
#: thường lọt qua đây sẽ chết trong `json.dumps`, và chỗ đó thì đang nuốt lỗi —
#: kết quả là phiên ấy âm thầm mất cả cửa sổ hội thoại mà không ai biết vì sao.
#: Khai kiểu ra để Pydantic chặn ngay tại một chỗ, có tên, đọc được.
#:
#: Phải dùng `TypeAliasType` chứ không viết `Json = None | bool | ... |
#: list["Json"]`: alias đệ quy kiểu đó làm Pydantic 2.13 dựng schema tới khi
#: tràn stack (đã thử).
Json = TypeAliasType(
    "Json", "None | bool | int | float | str | list[Json] | dict[str, Json]"
)


class StoredCall(Base):
    """Lời gọi tool như lúc cất xuống kho.

    `thought_signature` PHẢI đi trọn vẹn: thiếu nó thì Gemini 3.x từ chối cả
    request (xem `types.ToolCall`). Cất một hội thoại rồi đọc lại mà rơi mất chữ
    ký thì lỗi đó quay lại đúng ở lượt đầu sau khi khởi động lại.
    """

    name: str
    args: dict[str, Json] = {}
    thought_signature: str | None = None


class StoredTurn(Base):
    """Một lượt hội thoại như lúc cất xuống kho.

    Dùng Pydantic vì cùng lý do `domain/models.py` đã nêu: dữ liệu đọc lên từ
    JSON được kiểm hình dạng NGAY TẠI CỬA thay vì nổ ở giữa. Chỗ này còn thêm
    một lý do nữa — nó cũng là cửa GHI, xem chú thích ở `Json`.
    """

    role: Literal["user", "model", "tool"]
    text: str | None = None
    name: str | None = None
    result: Json = None
    call: StoredCall | None = None

    @classmethod
    def of(cls, message: AgentMessage) -> StoredTurn:
        return cls.model_validate(
            {
                "role": message.role,
                "text": message.text,
                "name": message.name,
                "result": message.result,
                "call": (
                    {
                        "name": message.call.name,
                        "args": message.call.args or {},
                        "thought_signature": message.call.thought_signature,
                    }
                    if message.call
                    else None
                ),
            }
        )

    def to_message(self) -> AgentMessage:
        return AgentMessage(
            role=self.role,
            text=self.text,
            name=self.name,
            result=self.result,
            call=(
                ToolCall(
                    name=self.call.name,
                    args=self.call.args,
                    thought_signature=self.call.thought_signature,
                )
                if self.call
                else None
            ),
        )


def to_rows(turns: list[AgentMessage]) -> list[dict]:
    """Cửa ghi, dùng chung cho cả ba kho.

    Dựng TOÀN BỘ payload trước khi động vào chỗ cất: một lượt sai hình dạng nổ ở
    đây, lúc kho còn chưa bị mở ra. Nhờ vậy hỏng của phiên này không lây sang
    phiên khác trong cùng file/cùng bảng.
    """
    return [StoredTurn.of(t).dump() for t in turns]


def to_messages(rows: list[dict]) -> list[AgentMessage]:
    return [StoredTurn.model_validate(r).to_message() for r in rows]


class TurnStore(Protocol):
    """Cổng cất hội thoại — cùng chính sách nuốt lỗi như `FactStore`.

    Đọc/ghi hỏng thì coi như rỗng: quên ngữ cảnh vài lượt còn hơn là cả trợ lý
    không nói được câu nào.
    """

    def read(self, session_id: str) -> list[AgentMessage]: ...
    def write(self, session_id: str, turns: list[AgentMessage]) -> None: ...
    def clear(self, session_id: str) -> None: ...


class InMemoryTurnStore:
    """Không cất xuống đâu cả — cho test và cho lúc chưa cấu hình chỗ lưu.

    Vẫn đi qua đúng cửa `to_rows`/`to_messages` dù chẳng cần tuần tự hoá gì:
    kho dùng lúc test mà dễ tính hơn kho chạy thật thì test không còn nói được
    gì về chuyện gì sẽ xảy ra trên production.
    """

    def __init__(self) -> None:
        self._by_session: dict[str, list[dict]] = {}

    def read(self, session_id: str) -> list[AgentMessage]:
        return to_messages(self._by_session.get(session_id, []))

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        self._by_session[session_id] = to_rows(turns)

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
            return to_messages(self._load().get(session_id, []))
        except Exception:
            # Méo/thiếu field thì coi như rỗng — chính sách cũ, chỉ khác là giờ
            # Pydantic phát hiện ngay ở cửa chứ không để nó nổ ở giữa vòng ReAct.
            return []

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        rows = to_rows(turns)
        data = self._load()
        data[session_id] = rows
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
        return to_messages(row[0] if row else [])

    def write(self, session_id: str, turns: list[AgentMessage]) -> None:
        # Dựng payload TRƯỚC khi mở kết nối: giá trị sai hình dạng không được
        # phép chết ở giữa `json.dumps` sau khi đã đụng vào CSDL.
        payload = json.dumps(to_rows(turns), ensure_ascii=False)
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_turns (session_id, data) VALUES (%s, %s)
                ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data
                """,
                (session_id, payload),
            )

    def clear(self, session_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM agent_turns WHERE session_id = %s", (session_id,)
            )
