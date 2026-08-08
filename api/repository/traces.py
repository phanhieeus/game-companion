"""Chỗ cất vết agent (C-022) — file khi chạy local, Postgres khi có CSDL.

Cùng lối rẽ như kho phiên (ADR 14 sửa ở C-017): đĩa của Render là tạm thời nên
production phải dùng CSDL, còn `npm run dev` không cần dựng Postgres mới chạy
được.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path

from psycopg import connect
from psycopg.rows import tuple_row

from ..tracing import MAX_TURNS_PER_SESSION, TraceTurn


def _percentile(values: list[int], pct: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round((pct / 100) * (len(ordered) - 1))))
    return ordered[index]


def _summarise(turns: list[dict]) -> dict:
    """Số liệu tính từ chính các vết đã lưu — không nuôi bộ đếm riêng.

    Bộ đếm riêng là nguồn sự thật thứ hai, và nó sẽ lệch. Đếm lại từ dữ liệu thì
    chậm hơn nhưng không bao giờ nói dối.
    """
    steps = [len(t.get("steps") or []) for t in turns]
    durations = [t["totalMs"] for t in turns if t.get("totalMs") is not None]
    outcomes = Counter(t.get("outcome") or "?" for t in turns)
    guardrails = Counter(
        g["name"] for t in turns for g in (t.get("guardrails") or [])
    )
    return {
        "turns": len(turns),
        "outcomes": dict(outcomes),
        "guardrails": dict(guardrails),
        "steps": {
            "avg": round(sum(steps) / len(steps), 2) if steps else 0,
            "max": max(steps) if steps else 0,
            "distribution": dict(Counter(steps)),
        },
        "latencyMs": {
            "p50": _percentile(durations, 50),
            "p95": _percentile(durations, 95),
            "max": max(durations) if durations else 0,
        },
    }


class FileTraceStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _load(self) -> list[dict]:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            return raw if isinstance(raw, list) else []
        except Exception:
            return []

    def _save(self, turns: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(turns, ensure_ascii=False), "utf-8")
        os.replace(temp, self.path)

    def append(self, turn: TraceTurn) -> None:
        turns = [*self._load(), turn.dump()]
        # Dọn theo TỪNG PHIÊN, không dọn theo tổng: một phiên nói nhiều không
        # được phép xoá mất vết của phiên khác.
        keep: list[dict] = []
        seen: Counter = Counter()
        for t in reversed(turns):
            sid = t.get("sessionId")
            if seen[sid] >= MAX_TURNS_PER_SESSION:
                continue
            seen[sid] += 1
            keep.append(t)
        self._save(list(reversed(keep)))

    def list(self, session_id: str, limit: int = 50) -> list[dict]:
        rows = [t for t in self._load() if t.get("sessionId") == session_id]
        return list(reversed(rows[-limit:]))

    def sessions(self, limit: int = 50) -> list[dict]:
        by_session: dict[str, dict] = {}
        for t in self._load():
            sid = t.get("sessionId")
            entry = by_session.setdefault(
                sid, {"sessionId": sid, "deviceId": t.get("deviceId"), "turns": 0,
                      "lastAt": t.get("at")}
            )
            entry["turns"] += 1
            entry["lastAt"] = max(entry["lastAt"] or "", t.get("at") or "")
        rows = sorted(by_session.values(), key=lambda r: r["lastAt"] or "", reverse=True)
        return rows[:limit]

    def stats(self) -> dict:
        return _summarise(self._load())


SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_traces (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    at         TEXT NOT NULL,
    data       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_traces_session ON agent_traces (session_id, at DESC);
"""


class PgTraceStore:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        with self._conn() as conn:
            conn.execute(SCHEMA)

    def _conn(self):
        return connect(self.dsn, row_factory=tuple_row, autocommit=True)

    def append(self, turn: TraceTurn) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO agent_traces (id, session_id, at, data) VALUES (%s,%s,%s,%s)"
                " ON CONFLICT (id) DO NOTHING",
                (turn.id, turn.sessionId, turn.at, json.dumps(turn.dump(),
                                                              ensure_ascii=False)),
            )
            # Dọn ngay trong lúc ghi: không có tiến trình dọn nền nào chạy trên
            # Render free, nên phải dọn ở đúng chỗ biết mình vừa thêm gì.
            conn.execute(
                """
                DELETE FROM agent_traces
                WHERE session_id = %s AND id NOT IN (
                    SELECT id FROM agent_traces
                    WHERE session_id = %s ORDER BY at DESC LIMIT %s
                )
                """,
                (turn.sessionId, turn.sessionId, MAX_TURNS_PER_SESSION),
            )

    def list(self, session_id: str, limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT data FROM agent_traces WHERE session_id = %s"
                " ORDER BY at DESC LIMIT %s",
                (session_id, limit),
            ).fetchall()
        return [r[0] for r in rows]

    def sessions(self, limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """
                SELECT session_id,
                       max(at)                       AS last_at,
                       count(*)                      AS turns,
                       max(data ->> 'deviceId')      AS device_id
                FROM agent_traces GROUP BY session_id
                ORDER BY last_at DESC LIMIT %s
                """,
                (limit,),
            ).fetchall()
        return [
            {"sessionId": r[0], "lastAt": r[1], "turns": r[2], "deviceId": r[3]}
            for r in rows
        ]

    def stats(self) -> dict:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT data FROM agent_traces ORDER BY at DESC LIMIT 2000"
            ).fetchall()
        return _summarise([r[0] for r in rows])
