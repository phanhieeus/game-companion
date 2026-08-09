"""Tool layer — hợp đồng ổn định. Xem docs/product/tools.md.

Tên hàm giữ nguyên snake_case đúng như "tool" trong kiến trúc plugin tương lai
(decision 0001). Mọi thao tác ghi điểm đi qua đây, một điểm duy nhất, để sau gắn
Event Bus.

Bản dịch từ TypeScript (ADR 16): giữ NGUYÊN tên hàm, tên tham số và từng câu
thông báo lỗi. Client đang hiện thẳng những câu đó lên màn hình, và 44 test e2e
viết cho bản cũ phải chạy được với bản này mà không sửa một assertion nào.
"""

from __future__ import annotations

import random
import string
from datetime import datetime, timezone
from typing import Callable

from pydantic import ValidationError

from ..domain.errors import Result, err, ok
from ..domain.models import (
    DEFAULT_SCORING_CONFIG,
    MAX_PLAYERS,
    DraftEntry,
    Player,
    Round,
    RoundEvent,
    RoundEventEntry,
    ScoreEntry,
    ScoringConfig,
    Session,
)
from ..domain.scoring import (
    TimelineItem,
    compute_scoreboard,
    describe_action,
    latest_recorded_round,
    next_redo_target,
    next_sequence_no,
    next_undo_target,
    undo_depth_of,
    validate_player_count,
    validate_round_entries,
    validate_scoring_config,
)
from ..guardrails import (
    SessionLocks,
    check_deltas,
    check_round_count,
    clean_name,
)
from ..repository.base import SessionRepository

_id_counter = 0


def _new_id(prefix: str) -> str:
    global _id_counter
    _id_counter += 1
    stamp = _base36(int(datetime.now(timezone.utc).timestamp() * 1000))
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{prefix}_{stamp}{_base36(_id_counter)}{suffix}"


def _base36(number: int) -> str:
    digits = string.digits + string.ascii_lowercase
    if number == 0:
        return "0"
    out = ""
    while number:
        number, rem = divmod(number, 36)
        out = digits[rem] + out
    return out


def reset_id_counter() -> None:
    """Cho test đặt lại bộ đếm để id ổn định giữa các case."""
    global _id_counter
    _id_counter = 0


def _now() -> str:
    # Đuôi "Z" cho khớp `toISOString()` của JS — nhật ký sắp xếp theo chuỗi này.
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _merged_config(base: ScoringConfig, patch: dict) -> Result[ScoringConfig]:
    """Đắp một mẩu cấu hình lên cấu hình cũ, và KIỂM HÌNH DẠNG lại từ đầu.

    `model_copy(update=…)` nhận thẳng bất cứ thứ gì gọi vào — đưa cho nó một
    danh sách dict thì `bonuses` ở lại dạng dict, và chỗ đọc sẽ nổ mãi sau đó,
    xa chỗ gây ra. Dựng lại bằng `model_validate` để sai hình dạng thì sai ngay
    tại cửa, và mỗi phiên có danh sách của riêng nó.
    """
    try:
        return ok(ScoringConfig.model_validate({**base.model_dump(), **patch}))
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(p) for p in first["loc"]) or "luật"
        return err("SCORING_CONFIG_INVALID", f"Luật tính điểm sai ở '{where}'.")


def _same_entries(a: list[RoundEventEntry], b: list[RoundEventEntry]) -> bool:
    """Hai bộ điểm có giống hệt nhau không (không kể thứ tự).

    Dùng để bỏ qua lần sửa rỗng: mở ô ra xem rồi bấm Lưu mà không đổi gì thì
    không nên sinh mục nhật ký, không nên đánh dấu ván là "đã sửa", và nhất là
    không nên đẩy con trỏ undo — làm vậy sẽ xoá nhánh làm lại một cách vô cớ.
    """
    if len(a) != len(b):
        return False
    left = {e.playerId: e.delta for e in a}
    return all(left.get(e.playerId) == e.delta for e in b)


def _snapshot(round_: Round) -> list[RoundEventEntry]:
    """Ảnh chụp điểm của một ván, để ghi vào nhật ký."""
    return [RoundEventEntry(playerId=e.playerId, delta=e.delta) for e in round_.entries]


def _append_event(
    round_: Round,
    kind: str,
    source: str,
    *,
    before: list[RoundEventEntry] | None = None,
    after: list[RoundEventEntry] | None = None,
    is_undo: bool = False,
    is_redo: bool = False,
) -> None:
    """Ghi một mục vào nhật ký của ván.

    Nhật ký là bất biến: chỉ thêm, không bao giờ sửa hay xoá mục cũ. Đây là điều
    kiện để mở tính năng sửa ô trực tiếp (ADR 8) — không có nó thì "ván 3 sao
    khác lúc nãy" thành câu hỏi không trả lời được.
    """
    event = RoundEvent(
        id=_new_id("evt"),
        kind=kind,  # type: ignore[arg-type]
        at=_now(),
        source=source,  # type: ignore[arg-type]
        before=before,
        after=after,
        isUndo=True if is_undo else None,
        isRedo=True if is_redo else None,
    )
    round_.events = [*(round_.events or []), event]


def _restore_entries(round_: Round, entries: list[RoundEventEntry]) -> None:
    """Gán lại điểm của ván từ một ảnh chụp trong nhật ký."""
    round_.entries = [
        ScoreEntry(
            id=_new_id("ent"), roundId=round_.id, playerId=e.playerId, delta=e.delta
        )
        for e in entries
    ]


def _apply_inverse(round_: Round, item: TimelineItem) -> None:
    """Đảo ngược một thao tác (bấm Hoàn tác)."""
    event = item.event
    if event.kind in ("created", "restored"):
        round_.status = "voided"
        _append_event(
            round_, "voided", event.source, before=_snapshot(round_), is_undo=True
        )
    elif event.kind == "voided":
        round_.status = "recorded"
        _append_event(
            round_, "restored", event.source, after=_snapshot(round_), is_undo=True
        )
    elif event.kind == "updated":
        before = _snapshot(round_)
        if event.before:
            _restore_entries(round_, event.before)
        _append_event(
            round_,
            "updated",
            event.source,
            before=before,
            after=_snapshot(round_),
            is_undo=True,
        )


def _apply_forward(round_: Round, item: TimelineItem) -> None:
    """Làm lại một thao tác đã hoàn tác."""
    event = item.event
    if event.kind in ("created", "restored"):
        round_.status = "recorded"
        if event.after:
            _restore_entries(round_, event.after)
        _append_event(
            round_, "restored", event.source, after=_snapshot(round_), is_redo=True
        )
    elif event.kind == "voided":
        round_.status = "voided"
        _append_event(
            round_, "voided", event.source, before=_snapshot(round_), is_redo=True
        )
    elif event.kind == "updated":
        before = _snapshot(round_)
        if event.after:
            _restore_entries(round_, event.after)
        _append_event(
            round_,
            "updated",
            event.source,
            before=before,
            after=_snapshot(round_),
            is_redo=True,
        )


class Tools:
    """Hợp đồng ổn định — chữ ký giữ nguyên từ bản TypeScript."""

    def __init__(
        self,
        repo: SessionRepository,
        on_session_ended: Callable[[str], None] | None = None,
    ) -> None:
        self.repo = repo
        # Khoá theo phiên, bọc quanh đọc-sửa-ghi (C-021). Không có nó thì hai
        # request cùng lúc trên một phiên làm mất ván của nhau.
        self.locks = SessionLocks()
        #: Gọi khi một phiên vừa kết thúc — để tầng trên dọn trí nhớ của nó.
        #:
        #: Trí nhớ agent khoá theo phiên (C-027), nhưng tool layer không biết
        #: kho nhớ tồn tại và cũng không nên biết. Móc này là chỗ DUY NHẤT cả
        #: hai đường kết thúc phiên — tool của agent và `/end` gọi thẳng — cùng
        #: đi qua, nên treo ở đây thì không đường nào lọt. Trước đó dọn ở route
        #: agent, tức phiên kết thúc bằng nút "Kết thúc" rồi không nói gì nữa
        #: sẽ để trí nhớ nằm lại vĩnh viễn.
        self.on_session_ended = on_session_ended

    def _load(self, session_id: str, for_write: bool) -> Result[Session]:
        """Lấy phiên và chặn thao tác ghi lên phiên đã kết thúc."""
        session = self.repo.get(session_id)
        if session is None:
            return err("SESSION_NOT_FOUND", f"Không tìm thấy phiên {session_id}.")
        if for_write and session.status == "ended":
            return err("SESSION_ENDED", "Phiên đã kết thúc, không ghi thêm được.")
        return ok(session)

    # ── Phiên ────────────────────────────────────────────────────────────

    def create_session(
        self,
        players: list[dict],
        name: str | None = None,
        scoring_config: dict | None = None,
        me_player_name: str | None = None,
        device_id: str | None = None,
    ) -> Result[dict]:
        count = validate_player_count(len(players))
        if not count.ok:
            return count

        session_id = _new_id("ses")
        records = [
            Player(
                id=_new_id("ply"),
                sessionId=session_id,
                name=clean_name(p.get("name", "")),
                seatNo=p.get("seat_no", index + 1),
                status="active",
            )
            for index, p in enumerate(players)
        ]

        me = None
        if me_player_name:
            needle = me_player_name.strip().lower()
            me = next((p for p in records if p.name.lower() == needle), None)

        # `model_validate` chứ không `model_copy`: copy chỉ là copy NÔNG, nên
        # mọi phiên sẽ dùng chung đúng một danh sách `bonuses` của hằng mặc
        # định — sửa luật nhà ở phiên này là sửa luôn phiên khác.
        config = _merged_config(DEFAULT_SCORING_CONFIG, scoring_config or {})
        if not config.ok:
            return config
        session = Session(
            id=session_id,
            name=name,
            status="active",
            scoringConfig=config.unwrap(),
            players=records,
            rounds=[],
            createdAt=_now(),
            mePlayerId=me.id if me else None,
            confirmBeforeCommit=True,
            deviceId=device_id,
        )

        self.repo.save(session)
        return ok({"session_id": session_id, "scoreboard": compute_scoreboard(session)})

    def add_player(
        self, session_id: str, name: str, seat_no: int | None = None
    ) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        active_count = len([p for p in session.players if p.status == "active"])
        if active_count >= MAX_PLAYERS:
            return err("TOO_MANY_PLAYERS", f"Tối đa {MAX_PLAYERS} người chơi.")

        player = Player(
            id=_new_id("ply"),
            sessionId=session.id,
            name=clean_name(name),
            seatNo=seat_no if seat_no is not None else active_count + 1,
            status="active",
        )
        session.players.append(player)
        self.repo.save(session)
        return ok({"player_id": player.id})

    def remove_player(self, session_id: str, player_id: str) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        player = next((p for p in session.players if p.id == player_id), None)
        if player is None or player.status != "active":
            return err(
                "PLAYER_NOT_IN_SESSION", f"Người chơi {player_id} không thuộc phiên này."
            )

        # Đánh dấu removed, không xoá — các ván cũ vẫn phải tính đúng như đã ghi.
        player.status = "removed"
        self.repo.save(session)
        return ok({"ok": True})

    def update_scoring_config(
        self, session_id: str, scoring_config: dict
    ) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        merged = _merged_config(session.scoringConfig, scoring_config)
        if not merged.ok:
            return merged

        checked = validate_scoring_config(session, merged.unwrap())
        if not checked.ok:
            return checked

        # Ván đã ghi không hồi tố — xem docs/product/open-questions.md.
        session.scoringConfig = checked.unwrap()
        self.repo.save(session)
        return ok({"ok": True})

    def set_confirm_before_commit(self, session_id: str, enabled: bool) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()
        session.confirmBeforeCommit = enabled
        self.repo.save(session)
        return ok({"ok": True})

    def end_session(self, session_id: str) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        session.status = "ended"
        session.endedAt = _now()
        self.repo.save(session)
        if self.on_session_ended is not None:
            # Dọn trí nhớ NGAY, không đợi lượt nói kế tiếp — phiên kết thúc rồi
            # thì rất có thể không còn lượt nào nữa.
            self.on_session_ended(session_id)
        return ok({"scoreboard": compute_scoreboard(session)})

    # ── Ván ──────────────────────────────────────────────────────────────

    def record_round(
        self,
        session_id: str,
        entries: list[DraftEntry],
        client_request_id: str | None = None,
        source: str = "voice",
    ) -> Result[dict]:
        out_of_range = check_deltas(e.delta for e in entries)
        if out_of_range:
            return err("SUM_DELTA_NOT_ZERO", out_of_range.message)

        with self.locks.for_session(session_id):
            return self._record_round_locked(
                session_id, entries, client_request_id, source
            )

    def _record_round_locked(
        self,
        session_id: str,
        entries: list[DraftEntry],
        client_request_id: str | None,
        source: str,
    ) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        too_many = check_round_count(len(session.rounds))
        if too_many:
            return err("SESSION_ENDED", too_many.message)

        # Idempotency: cùng client_request_id chỉ tạo một Round.
        if client_request_id:
            existing = next(
                (r for r in session.rounds if r.clientRequestId == client_request_id),
                None,
            )
            if existing:
                return ok(
                    {
                        "round_id": existing.id,
                        "scoreboard": compute_scoreboard(session),
                    }
                )

        validated = validate_round_entries(session, entries)
        if not validated.ok:
            return validated

        round_id = _new_id("rnd")
        round_ = Round(
            id=round_id,
            sessionId=session.id,
            sequenceNo=next_sequence_no(session.rounds),
            status="recorded",
            createdAt=_now(),
            source=source,  # type: ignore[arg-type]
            entries=[
                ScoreEntry(
                    id=_new_id("ent"),
                    roundId=round_id,
                    playerId=e.playerId,
                    delta=e.delta,
                )
                for e in validated.unwrap()
            ],
            clientRequestId=client_request_id,
        )
        _append_event(round_, "created", round_.source, after=_snapshot(round_))

        session.rounds.append(round_)
        session.undoDepth = 0
        self.repo.save(session)
        return ok({"round_id": round_id, "scoreboard": compute_scoreboard(session)})

    def update_round(
        self,
        session_id: str,
        round_id: str,
        entries: list[DraftEntry],
        source: str = "manual",
    ) -> Result[dict]:
        out_of_range = check_deltas(e.delta for e in entries)
        if out_of_range:
            return err("SUM_DELTA_NOT_ZERO", out_of_range.message)

        with self.locks.for_session(session_id):
            return self._update_round_locked(session_id, round_id, entries, source)

    def _update_round_locked(
        self,
        session_id: str,
        round_id: str,
        entries: list[DraftEntry],
        source: str,
    ) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        round_ = next((r for r in session.rounds if r.id == round_id), None)
        if round_ is None:
            return err("ROUND_NOT_FOUND", f"Không tìm thấy ván {round_id}.")

        validated = validate_round_entries(session, entries)
        if not validated.ok:
            return validated

        before = _snapshot(round_)
        was_voided = round_.status == "voided"

        # Sửa rỗng: điểm y hệt VÀ ván vẫn đang hiệu lực → không có gì để ghi.
        # Trả về thành công để UI đóng ô sửa như bình thường, nhưng không đụng
        # vào nhật ký lẫn con trỏ undo (ADR 9).
        nxt = [
            RoundEventEntry(playerId=e.playerId, delta=e.delta)
            for e in validated.unwrap()
        ]
        if not was_voided and _same_entries(before, nxt):
            return ok({"scoreboard": compute_scoreboard(session)})

        round_.entries = [
            ScoreEntry(
                id=_new_id("ent"),
                roundId=round_.id,
                playerId=e.playerId,
                delta=e.delta,
            )
            for e in validated.unwrap()
        ]
        # Sửa một ván đã hủy thì coi như khôi phục lại nó.
        round_.status = "recorded"

        _append_event(
            round_,
            "restored" if was_voided else "updated",
            source,
            before=before,
            after=_snapshot(round_),
        )
        session.undoDepth = 0

        self.repo.save(session)
        return ok({"scoreboard": compute_scoreboard(session)})

    def undo_round(
        self,
        session_id: str,
        round_id: str | None = None,
        source: str = "manual",
    ) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        target = (
            next((r for r in session.rounds if r.id == round_id), None)
            if round_id
            else latest_recorded_round(session.rounds)
        )

        if target is None:
            return err("NO_ROUND_TO_UNDO", "Không còn ván nào để hủy.")
        if target.status == "voided":
            return err("NO_ROUND_TO_UNDO", f"Ván {target.sequenceNo} đã bị hủy rồi.")

        # Hủy = đánh dấu rồi tính lại. Không bao giờ sửa tay điểm tổng.
        before = _snapshot(target)
        target.status = "voided"
        _append_event(target, "voided", source, before=before)
        session.undoDepth = 0

        self.repo.save(session)
        return ok(
            {
                "voided_round_id": target.id,
                "scoreboard": compute_scoreboard(session),
            }
        )

    # ── Hoàn tác toàn phiên ──────────────────────────────────────────────

    def undo_last(self, session_id: str) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        target = next_undo_target(session)
        if target is None:
            return err("NO_ROUND_TO_UNDO", "Không còn gì để hoàn tác.")

        round_ = next((r for r in session.rounds if r.id == target.round.id), None)
        if round_ is None:
            return err("ROUND_NOT_FOUND", "Không tìm thấy ván.")

        _apply_inverse(round_, target)
        session.undoDepth = undo_depth_of(session) + 1
        self.repo.save(session)

        return ok(
            {
                "label": describe_action("Đã hoàn tác", target),
                "scoreboard": compute_scoreboard(session),
            }
        )

    def redo_last(self, session_id: str) -> Result[dict]:
        loaded = self._load(session_id, True)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        target = next_redo_target(session)
        if target is None:
            return err("NO_ROUND_TO_UNDO", "Không còn gì để làm lại.")

        round_ = next((r for r in session.rounds if r.id == target.round.id), None)
        if round_ is None:
            return err("ROUND_NOT_FOUND", "Không tìm thấy ván.")

        _apply_forward(round_, target)
        session.undoDepth = max(0, undo_depth_of(session) - 1)
        self.repo.save(session)

        return ok(
            {
                "label": describe_action("Đã làm lại", target),
                "scoreboard": compute_scoreboard(session),
            }
        )

    def get_undo_state(self, session_id: str) -> Result[dict]:
        loaded = self._load(session_id, False)
        if not loaded.ok:
            return loaded
        session = loaded.unwrap()

        undo = next_undo_target(session)
        redo = next_redo_target(session)
        return ok(
            {
                "undo": describe_action("Hoàn tác", undo) if undo else None,
                "redo": describe_action("Làm lại", redo) if redo else None,
            }
        )

    # ── Đọc ──────────────────────────────────────────────────────────────

    def get_round_events(self, session_id: str, round_id: str) -> Result[dict]:
        loaded = self._load(session_id, False)
        if not loaded.ok:
            return loaded

        round_ = next((r for r in loaded.unwrap().rounds if r.id == round_id), None)
        if round_ is None:
            return err("ROUND_NOT_FOUND", f"Không tìm thấy ván {round_id}.")
        return ok({"events": round_.events or []})

    def get_scoreboard(self, session_id: str) -> Result:
        loaded = self._load(session_id, False)
        if not loaded.ok:
            return loaded
        return ok(compute_scoreboard(loaded.unwrap()))

    def get_player_score(self, session_id: str, player_id: str) -> Result[dict]:
        loaded = self._load(session_id, False)
        if not loaded.ok:
            return loaded

        board = compute_scoreboard(loaded.unwrap())
        row = next((r for r in board.rows if r.playerId == player_id), None)
        if row is None:
            return err(
                "PLAYER_NOT_IN_SESSION", f"Người chơi {player_id} không thuộc phiên này."
            )
        return ok({"name": row.name, "total": row.total, "rank": row.rank})

    def get_history(self, session_id: str, limit: int | None = None) -> Result[dict]:
        loaded = self._load(session_id, False)
        if not loaded.ok:
            return loaded

        rounds = sorted(loaded.unwrap().rounds, key=lambda r: -r.sequenceNo)
        return ok({"rounds": rounds[:limit] if limit else rounds})


def create_tools(
    repo: SessionRepository,
    on_session_ended: Callable[[str], None] | None = None,
) -> Tools:
    return Tools(repo, on_session_ended)
