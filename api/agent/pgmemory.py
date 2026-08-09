"""Nhớ lâu của agent trên Postgres — cùng lý do với kho phiên (C-017).

Từ C-027 nhớ lâu khoá theo phiên. Bảng cũ `agent_facts` chỉ có đúng một hàng
(`CHECK (id = 1)`) nên KHÔNG chuyển sang được: hàng đó là một đống luật nhà trộn
từ mọi bàn đã chơi, gán nó cho phiên nào cũng là bịa. Chuyển sang mọi phiên thì
tái lập đúng cái sai vừa bỏ; chuyển sang phiên mới nhất thì một nhóm bỗng thừa
hưởng luật của nhóm khác mà không ai nói cho họ biết. Nên **bỏ**: xoá bảng cũ,
dựng bảng mới khoá theo `session_id`.

Mất dữ liệu là CÓ CHỦ Ý và operator đã chốt (phiên mới không cần nhớ phiên cũ).
Xoá hẳn chứ không để bảng cũ nằm im, vì một bảng chết không ai đọc chỉ làm người
sau tưởng nó còn dùng.
"""

from __future__ import annotations

import json

from psycopg import connect
from psycopg.rows import tuple_row

from .memory import MemoryFact

SCHEMA = """
DROP TABLE IF EXISTS agent_facts;
CREATE TABLE IF NOT EXISTS agent_session_facts (
    session_id TEXT PRIMARY KEY,
    data       JSONB NOT NULL
);
"""


class PgFactStore:
    """Một hàng cho mỗi phiên, chứa cả danh sách của phiên đó.

    Nhớ lâu tối đa 20 điều mỗi phiên và luôn đọc/ghi trọn gói, nên tách mỗi điều
    một hàng chỉ thêm việc mà không thêm khả năng nào.
    """

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        with self._conn() as conn:
            conn.execute(SCHEMA)

    def _conn(self):
        return connect(self.dsn, row_factory=tuple_row, autocommit=True)

    def read(self, session_id: str) -> list[MemoryFact]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT data FROM agent_session_facts WHERE session_id = %s",
                (session_id,),
            ).fetchone()
        return [MemoryFact.model_validate(f) for f in (row[0] if row else [])]

    def write(self, session_id: str, facts: list[MemoryFact]) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_session_facts (session_id, data) VALUES (%s, %s)
                ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data
                """,
                (session_id, json.dumps([f.dump() for f in facts],
                                        ensure_ascii=False)),
            )

    def clear(self, session_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "DELETE FROM agent_session_facts WHERE session_id = %s", (session_id,)
            )
