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
    Player,
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


# ── Luật nhà: điểm theo thứ hạng và thưởng ─────────────────────────────────
#
# Bàn bài thật chơi theo luật có sẵn, và người chơi chỉ nói KẾT QUẢ: "Nam nhất,
# Lan nhì, Hùng ba, Tú bét". Phần dịch từ kết quả sang bốn con số nằm ở ĐÂY,
# thuần và kiểm được — không nằm trong prompt, vì một phép cộng sai do model
# đoán thì vào sổ và trông y như thật.

_RANK_WORDS = ["nhất", "nhì", "ba", "tư", "năm", "sáu", "bảy"]


def active_players(session: Session) -> list[Player]:
    return [p for p in session.players if p.status == "active"]


def rank_labels(count: int) -> list[str]:
    """["nhất", "nhì", "ba", "bét"] cho bàn 4 người.

    Người cuối cùng luôn là "bét" chứ không phải "tư"/"năm" — đó là chữ người ta
    nói ra ở bàn, và cũng là chữ hiện lên màn Cài đặt.
    """
    if count <= 0:
        return []
    labels = _RANK_WORDS[:count] + [str(i + 1) for i in range(len(_RANK_WORDS), count)]
    labels[-1] = "bét"
    return labels


def players_missing_from(session: Session, entries: list[DraftEntry]) -> list[str]:
    """Tên những người ĐANG CHƠI mà ván không nhắc tới.

    Vắng tên không có nghĩa là 0 điểm — nó có nghĩa là chưa biết. Cho một người
    không được nhắc tên con số 0 là kiểu sai tệ nhất app này có thể mắc: nó vào
    sổ, trông như thật, và không ai biết để cãi.
    """
    named = {e.playerId for e in entries}
    return [p.name for p in active_players(session) if p.id not in named]


def describe_missing(missing: list[str]) -> str:
    """Lời nhắc để agent hỏi lại — không phải lời xin lỗi, mà là câu hỏi cụ thể."""
    return (
        f"Chưa biết điểm của {', '.join(missing)}. Hỏi lại rồi mới ghi; "
        "tuyệt đối không tự cho ai 0 điểm chỉ vì không nghe thấy tên."
    )


def validate_scoring_config(session: Session, config: ScoringConfig) -> Result[ScoringConfig]:
    """Chặn luật nhà vô nghĩa ngay lúc ĐẶT, không đợi tới lúc ghi ván.

    Sai ở đây thì người ta còn đang nhìn màn Cài đặt và sửa được ngay; sai lúc
    ghi ván thì đang giữa ván bài và chỉ thấy một câu từ chối khó hiểu.
    """
    count = len(active_players(session))

    if config.rankPoints is not None:
        if len(config.rankPoints) != count:
            return err(
                "RANK_POINTS_MISMATCH",
                f"Bảng hạng có {len(config.rankPoints)} mức nhưng bàn đang có "
                f"{count} người. Cho đủ {count} mức, từ nhất xuống bét.",
            )
        if config.zeroSum and sum(config.rankPoints) != 0:
            # zeroSum vẫn là cổng cuối: có luật nhà rồi cũng không nới nó. Bắt ở
            # đây để người đặt luật biết ngay, thay vì mỗi ván ghi lại bị chặn.
            return err(
                "SUM_DELTA_NOT_ZERO",
                f"Tổng bảng hạng phải bằng 0, đang là {sum(config.rankPoints)}.",
            )

    for bonus in config.bonuses:
        if not bonus.name.strip():
            return err("BONUS_INVALID", "Thưởng phải có tên.")
        if bonus.paidBy == "split" and count > 1 and bonus.points % (count - 1) != 0:
            return err(
                "BONUS_INVALID",
                f'Thưởng "{bonus.name}" {bonus.points} điểm chia đều cho '
                f"{count - 1} người không ra số nguyên.",
            )

    return ok(config)


def deltas_from_ranking(
    session: Session,
    ranking: list[str],
    awards: list[tuple[str, str]],
) -> Result[list[DraftEntry]]:
    """Thứ hạng + thưởng → điểm từng người, theo luật nhà của phiên.

    `ranking` là id người chơi xếp từ nhất xuống bét; `awards` là các cặp
    (tên thưởng, id người ăn). Kết quả LUÔN có đủ mọi người đang chơi, kể cả
    người 0 điểm — nhờ vậy ván suy ra từ đây không bao giờ bỏ sót ai.
    """
    players = active_players(session)
    ids = [p.id for p in players]
    names = {p.id: p.name for p in players}
    config = session.scoringConfig
    totals: dict[str, int] = {pid: 0 for pid in ids}

    if not ranking and not awards:
        return err("EMPTY_ROUND", "Chưa nói thứ hạng lẫn thưởng nào.")

    if ranking:
        if not config.rankPoints:
            return err(
                "NO_RANK_POINTS",
                "Phiên này chưa đặt bảng điểm theo thứ hạng. Đặt ở màn Cài đặt "
                "hoặc nói rõ luật trước đã.",
            )
        # Thêm/bớt người giữa phiên thì bảng hạng cũ không dùng được nữa. Báo
        # dứt khoát; im lặng co giãn bảng là tự bịa ra luật nhà mới.
        if len(config.rankPoints) != len(players):
            return err(
                "RANK_POINTS_MISMATCH",
                f"Bảng hạng đang đặt cho {len(config.rankPoints)} người nhưng "
                f"bàn đang có {len(players)}. Đặt lại bảng hạng rồi hãy ghi.",
            )
        unknown = [pid for pid in ranking if pid not in totals]
        if unknown:
            return err("PLAYER_NOT_IN_SESSION", "Có người không thuộc phiên này.")
        if len(set(ranking)) != len(ranking):
            return err(
                "DUPLICATE_PLAYER_IN_ROUND", "Một người không thể vừa nhất vừa nhì."
            )
        missing = [names[pid] for pid in ids if pid not in ranking]
        if missing:
            return err("MISSING_PLAYERS", describe_missing(missing))
        for index, pid in enumerate(ranking):
            totals[pid] += config.rankPoints[index]

    for bonus_name, winner_id in awards:
        needle = (bonus_name or "").strip().lower()
        bonus = next((b for b in config.bonuses if b.name.lower() == needle), None)
        if bonus is None:
            known = ", ".join(f'"{b.name}"' for b in config.bonuses) or "chưa có gì"
            return err(
                "BONUS_NOT_FOUND",
                f'Luật nhà không có thưởng "{bonus_name}". Đang có: {known}.',
            )
        if winner_id not in totals:
            return err("PLAYER_NOT_IN_SESSION", "Người ăn thưởng không thuộc phiên này.")

        others = [pid for pid in ids if pid != winner_id]
        if not others:
            return err("EMPTY_ROUND", "Không có ai chung thưởng.")

        if bonus.paidBy == "each":
            totals[winner_id] += bonus.points * len(others)
            for pid in others:
                totals[pid] -= bonus.points
        else:
            share, remainder = divmod(bonus.points, len(others))
            if remainder:
                return err(
                    "BONUS_INVALID",
                    f'Thưởng "{bonus.name}" {bonus.points} điểm chia đều cho '
                    f"{len(others)} người không ra số nguyên.",
                )
            totals[winner_id] += bonus.points
            for pid in others:
                totals[pid] -= share

    return ok([DraftEntry(playerId=pid, delta=totals[pid]) for pid in ids])


def describe_house_rules(session: Session) -> str:
    """Luật nhà bằng lời, để đọc lên khi xin xác nhận và để nhét vào prompt."""
    config = session.scoringConfig
    count = len(active_players(session))
    parts: list[str] = []

    if config.rankPoints:
        labels = rank_labels(len(config.rankPoints))
        parts.append(
            "hạng: "
            + ", ".join(
                f"{label} {'+' if point > 0 else ''}{point}"
                for label, point in zip(labels, config.rankPoints)
            )
        )
        if len(config.rankPoints) != count:
            parts.append(f"(đang đặt cho {len(config.rankPoints)} người, bàn có {count})")

    for bonus in config.bonuses:
        how = "mỗi người còn lại chung đủ" if bonus.paidBy == "each" else "chia đều"
        parts.append(f'"{bonus.name}" {bonus.points} điểm, {how}')

    return "; ".join(parts)


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
    if config.rankPoints:
        parts.append("có bảng điểm theo thứ hạng")
    if config.bonuses:
        parts.append(f"{len(config.bonuses)} khoản thưởng")
    return ", ".join(parts)
