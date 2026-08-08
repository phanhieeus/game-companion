"""Nửa Python của phép đối chiếu — xem scripts/parity.mjs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.domain.models import DraftEntry  # noqa: E402
from api.repository.memory import MemorySessionRepository  # noqa: E402
from api.tools import create_tools, reset_id_counter  # noqa: E402


def main() -> None:
    script = json.loads(sys.argv[1])

    reset_id_counter()
    repo = MemorySessionRepository()
    tools = create_tools(repo)

    created = tools.create_session(
        players=[{"name": n} for n in ["Nam", "Hùng", "Lan", "Tú"]]
    )
    session_id = created.unwrap()["session_id"]
    ids = [r.playerId for r in created.unwrap()["scoreboard"].rows]
    round_ids: list[str | None] = []

    def entries(deltas):
        return [DraftEntry(playerId=ids[i], delta=d) for i, d in enumerate(deltas)]

    for step in script:
        op = step["op"]
        if op == "record":
            r = tools.record_round(session_id, entries(step["deltas"]), source="manual")
            round_ids.append(r.unwrap()["round_id"] if r.ok else None)
        elif op == "update":
            tools.update_round(
                session_id,
                round_ids[step["round"] - 1],
                entries(step["deltas"]),
                source="manual",
            )
        elif op == "undo_round":
            tools.undo_round(session_id, round_ids[step["round"] - 1], source="manual")
        elif op == "undo_last":
            tools.undo_last(session_id)
        elif op == "redo_last":
            tools.redo_last(session_id)

    board = tools.get_scoreboard(session_id).unwrap()
    undo = tools.get_undo_state(session_id).unwrap()
    session = repo.get(session_id)

    print(
        json.dumps(
            {
                "scoreboard": [[r.name, r.total, r.rank] for r in board.rows],
                "roundsPlayed": board.roundsPlayed,
                "undo": undo,
                "events": [
                    {
                        "seq": r.sequenceNo,
                        "status": r.status,
                        "kinds": [e.kind for e in (r.events or [])],
                        "flags": [
                            f"{'U' if e.isUndo else ''}{'R' if e.isRedo else ''}"
                            for e in (r.events or [])
                        ],
                    }
                    for r in session.rounds
                ],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
