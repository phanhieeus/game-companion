"""Kho phiên trên Postgres (ADR 14 sửa ở C-017).

Vì sao phải đổi: đĩa của Render free là TẠM THỜI — file JSON bị xoá mỗi lần
redeploy hoặc ngủ dậy. Người dùng mất sạch phiên mà không hề được báo, đúng kiểu
hỏng tệ nhất: im lặng.

Cùng Protocol `SessionRepository` với bản file, nên scoring và tool layer không
đụng một dòng. Đây là lần thứ hai decision 0001 trả công.

Một bảng, `data` là JSONB nguyên khối. Chưa tách ván/người chơi ra bảng riêng:
chưa có truy vấn nào cần, mà tách là phải viết migration cho một hình dạng vẫn
đang đổi.
"""

from __future__ import annotations

import json

from psycopg import connect
from psycopg.rows import tuple_row

from ..domain.models import Session

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    data       JSONB       NOT NULL,
    created_at TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_created_at ON sessions (created_at DESC);
-- Tra phiên đang chơi của một thiết bị là truy vấn chạy mỗi lần mở app.
CREATE INDEX IF NOT EXISTS sessions_device
    ON sessions ((data ->> 'deviceId'), (data ->> 'status'));
"""


class PgSessionRepository:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        with self._conn() as conn:
            conn.execute(SCHEMA)

    def _conn(self):
        # Mở kết nối theo từng thao tác: app này vài request mỗi phút, không
        # đáng để nuôi một pool. Đổi sau chỉ sửa đúng hàm này.
        return connect(self.dsn, row_factory=tuple_row, autocommit=True)

    def get(self, session_id: str) -> Session | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT data FROM sessions WHERE id = %s", (session_id,)
            ).fetchone()
        return Session.model_validate(row[0]) if row else None

    def save(self, session: Session) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, data, created_at, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (id) DO UPDATE
                    SET data = EXCLUDED.data, updated_at = now()
                """,
                (session.id, json.dumps(session.dump()), session.createdAt),
            )

    def list(self) -> list[Session]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT data FROM sessions ORDER BY created_at DESC"
            ).fetchall()
        return [Session.model_validate(r[0]) for r in rows]

    def delete(self, session_id: str) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM sessions WHERE id = %s", (session_id,))

    def active_session(self, device_id: str | None) -> Session | None:
        if not device_id:
            return None
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT data FROM sessions
                WHERE data ->> 'status' = 'active'
                  AND data ->> 'deviceId' = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (device_id,),
            ).fetchone()
        return Session.model_validate(row[0]) if row else None
