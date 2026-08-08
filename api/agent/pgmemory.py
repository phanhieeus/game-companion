"""Nhớ lâu của agent trên Postgres — cùng lý do với kho phiên (C-017)."""

from __future__ import annotations

import json

from psycopg import connect
from psycopg.rows import tuple_row

from .memory import MemoryFact

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_facts (
    id   INTEGER PRIMARY KEY DEFAULT 1,
    data JSONB   NOT NULL,
    CONSTRAINT agent_facts_single_row CHECK (id = 1)
);
"""


class PgFactStore:
    """Một hàng duy nhất chứa cả danh sách.

    Nhớ lâu tối đa 20 điều và luôn đọc/ghi trọn gói, nên tách hàng chỉ thêm việc
    mà không thêm khả năng nào. `CHECK (id = 1)` để ràng buộc đó nằm trong CSDL
    chứ không nằm trong trí nhớ người viết code.
    """

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        with self._conn() as conn:
            conn.execute(SCHEMA)

    def _conn(self):
        return connect(self.dsn, row_factory=tuple_row, autocommit=True)

    def read(self) -> list[MemoryFact]:
        with self._conn() as conn:
            row = conn.execute("SELECT data FROM agent_facts WHERE id = 1").fetchone()
        return [MemoryFact.model_validate(f) for f in (row[0] if row else [])]

    def write(self, facts: list[MemoryFact]) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO agent_facts (id, data) VALUES (1, %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                """,
                (json.dumps([f.dump() for f in facts]),),
            )
