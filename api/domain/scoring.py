"""Scoring engine — thuần, không I/O. Xem docs/product/scoring.md.

Đây là nơi duy nhất tính ra điểm tổng. Nếu cần sửa cách tính, sửa ở đây; đừng
rải logic ghi điểm ra chỗ khác (decision 0001).
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import Result, err, ok
from .models import (
    MAX_PLAYERS,
    MIN_PLAYERS,
    DraftEntry,
    Round,
    RoundEvent,
    ScoreEntry,
    Scoreboard,
    ScoreboardRow,
    ScoringConfig,
    Session,
)


def compute_scoreboard(session: Session) -> Scoreboard:
    """Điểm của một người = startingScore + tổng delta các ván 'recorded'."""
    starting = session.scoringConfig.startingScore
    active = [p for p in session.players if p.status == "active"]

    totals: dict[str, int] = {p.id: starting for p in active}

    recorded = [r for r in session.rounds if r.status == "recorded"]
    for round_ in recorded:
        for entry in round_.entries:
            # Ván cũ có thể chứa người đã bị xoá khỏi phiên — bỏ qua, không
            # dựng lại người đó chỉ vì tên họ còn trong lịch sử.
            if entry.playerId not in totals:
                continue
            totals[entry.playerId] += entry.delta

    rows = [
        ScoreboardRow(
            playerId=p.id, name=p.name, total=totals.get(p.id, starting), rank=0
        )
        for p in active
    ]
    # `sorted` của Python ổn định, `Array.sort` của V8 cũng vậy — hai bên cho
    # cùng thứ tự khi đồng điểm, nên bảng điểm khớp nhau từng dòng.
    rows.sort(key=lambda r: -r.total)

    # Đồng điểm = đồng hạng; hạng kế tiếp nhảy qua (1,2,2,4).
    previous_total: int | None = None
    previous_rank = 0
    for index, row in enumerate(rows):
        if previous_total is not None and row.total == previous_total:
            row.rank = previous_rank
        else:
            row.rank = index + 1
            previous_rank = row.rank
            previous_total = row.total

    return Scoreboard(rows=rows, roundsPlayed=len(recorded))


def validate_round_entries(
    session: Session, entries: list[DraftEntry]
) -> Result[list[DraftEntry]]:
    """Kiểm tra một ván trước khi ghi.

    Ràng buộc zero-sum ở đây là lưới an toàn chính chống STT nghe nhầm số: nếu
    tổng ≠ 0 thì gần như chắc chắn nghe sai, nên từ chối thay vì ghi bừa.
    """
    if not entries:
        return err("EMPTY_ROUND", "Ván không có người chơi nào.")

    active_ids = {p.id for p in session.players if p.status == "active"}

    seen: set[str] = set()
    for entry in entries:
        if entry.playerId not in active_ids:
            return err(
                "PLAYER_NOT_IN_SESSION",
                f"Người chơi {entry.playerId} không thuộc phiên này.",
            )
        if entry.playerId in seen:
            return err(
                "DUPLICATE_PLAYER_IN_ROUND",
                f"Người chơi {entry.playerId} xuất hiện hai lần trong một ván.",
            )
        seen.add(entry.playerId)

        if not isinstance(entry.delta, int) or isinstance(entry.delta, bool):
            return err("SUM_DELTA_NOT_ZERO", "Điểm phải là số nguyên.")

    config = session.scoringConfig

    if config.zeroSum:
        total = sum(e.delta for e in entries)
        if total != 0:
            return err(
                "SUM_DELTA_NOT_ZERO",
                f"Tổng điểm của ván phải bằng 0, đang là {total}.",
            )

    if not config.allowNegative:
        board = compute_scoreboard(session)
        for entry in entries:
            row = next((r for r in board.rows if r.playerId == entry.playerId), None)
            nxt = (row.total if row else config.startingScore) + entry.delta
            if nxt < 0:
                who = row.name if row else entry.playerId
                return err(
                    "NEGATIVE_NOT_ALLOWED",
                    f"Cấu hình không cho điểm âm; {who} sẽ còn {nxt}.",
                )

    return ok(entries)


def validate_player_count(count: int) -> Result[int]:
    if count < MIN_PLAYERS:
        return err("TOO_FEW_PLAYERS", f"Cần ít nhất {MIN_PLAYERS} người chơi.")
    if count > MAX_PLAYERS:
        return err("TOO_MANY_PLAYERS", f"Tối đa {MAX_PLAYERS} người chơi.")
    return ok(count)


def next_sequence_no(rounds: list[Round]) -> int:
    return max((r.sequenceNo for r in rounds), default=0) + 1


def latest_recorded_round(rounds: list[Round]) -> Round | None:
    """Ván gần nhất còn hiệu lực — mục tiêu mặc định của undo."""
    latest: Round | None = None
    for round_ in rounds:
        if round_.status != "recorded":
            continue
        if latest is None or round_.sequenceNo > latest.sequenceNo:
            latest = round_
    return latest


def total_of(entries: list[ScoreEntry] | list[DraftEntry]) -> int:
    return sum(e.delta for e in entries)


def round_events(round_: Round) -> list[RoundEvent]:
    """Đọc nhật ký của một ván, chịu được dữ liệu cũ chưa có field `events`."""
    return round_.events or []


def was_modified(round_: Round) -> bool:
    """Có từng bị sửa hoặc hủy chưa — quyết định hiện dấu trên hàng."""
    return any(e.kind != "created" for e in round_events(round_))


@dataclass(frozen=True)
class TimelineItem:
    """Một mục nhật ký kèm ván chứa nó — dùng cho ngăn xếp undo toàn phiên."""

    event: RoundEvent
    round: Round


def session_timeline(session: Session) -> list[TimelineItem]:
    """Mọi mục nhật ký của cả phiên, xếp theo thời gian tăng dần."""
    items = [
        TimelineItem(event=event, round=round_)
        for round_ in session.rounds
        for event in round_events(round_)
    ]
    # Cùng mốc thời gian thì phân giải bằng id, để thứ tự luôn tất định —
    # ghi hai ván trong cùng mili-giây là chuyện xảy ra thật.
    items.sort(key=lambda i: (i.event.at, i.event.id))
    return items


def action_timeline(session: Session) -> list[TimelineItem]:
    """Chuỗi thao tác THẬT (bỏ các mục do bấm Hoàn tác/Làm lại sinh ra).

    Con trỏ undo chỉ đi trên chuỗi này. Nếu tính cả mục undo thì bấm Hoàn tác
    hai lần sẽ hoàn tác chính lần hoàn tác đầu — tức là redo, không phải điều
    người dùng muốn.
    """
    return [i for i in session_timeline(session) if not i.event.isUndo and not i.event.isRedo]


def undo_depth_of(session: Session) -> int:
    return session.undoDepth or 0


def next_undo_target(session: Session) -> TimelineItem | None:
    """Thao tác kế tiếp sẽ bị hoàn tác, hoặc None nếu đã lùi hết."""
    actions = action_timeline(session)
    index = len(actions) - 1 - undo_depth_of(session)
    return actions[index] if index >= 0 else None


def next_redo_target(session: Session) -> TimelineItem | None:
    """Thao tác kế tiếp sẽ được làm lại, hoặc None nếu đang ở hiện tại."""
    depth = undo_depth_of(session)
    if depth <= 0:
        return None
    actions = action_timeline(session)
    index = len(actions) - depth
    return actions[index] if 0 <= index < len(actions) else None


KIND_VERB: dict[str, str] = {
    "created": "thêm",
    "updated": "sửa",
    "voided": "xóa",
    "restored": "khôi phục",
}


def describe_action(prefix: str, item: TimelineItem) -> str:
    """Nhãn cho nút, ví dụ "Hoàn tác sửa ván 3"."""
    return f"{prefix} {KIND_VERB[item.event.kind]} ván {item.round.sequenceNo}"


def describe_config(config: ScoringConfig) -> str:
    parts = ["nhập điểm trực tiếp"]
    if config.zeroSum:
        parts.append("tổng mỗi ván = 0")
    if config.startingScore != 0:
        parts.append(f"bắt đầu từ {config.startingScore}")
    return ", ".join(parts)
