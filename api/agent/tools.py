"""Danh mục tool của agent.

Nguyên tắc: **agent làm được đúng những gì tay làm được** — không hơn, không
kém. Mỗi tool đi qua đúng tool layer đã có (decision 0001), nên validate
zero-sum, nhật ký, undo/redo dùng chung một đường, không có lối tắt.

`needs_confirm` khai ở đây chứ không để model tự quyết (ADR 12).
"""

from __future__ import annotations

from ..domain.models import DraftEntry
from ..domain.scoring import compute_scoreboard
from .types import AgentTool, ProposalRow, ToolContext, ToolResult


def _ok(data, *, say: str | None = None, changed: bool = False) -> ToolResult:
    return ToolResult(ok=True, data=data, say=say, changed=changed)


def _fail(message: str) -> ToolResult:
    return ToolResult(ok=False, data={"error": message})


def _find_player(ctx: ToolContext, name_or_id: str):
    """Tên → người chơi, chịu được sai chính tả nhẹ do nhận dạng giọng nói."""
    active = [p for p in ctx.session.players if p.status == "active"]
    needle = (name_or_id or "").strip().lower()

    by_id = next((p for p in active if p.id == name_or_id), None)
    if by_id:
        return by_id
    exact = next((p for p in active if p.name.lower() == needle), None)
    if exact:
        return exact
    # "Hùn" → "Hùng": khớp tiền tố khi chỉ có ĐÚNG MỘT ứng viên. Hai người cùng
    # tiền tố thì thà hỏi lại còn hơn ghi nhầm điểm cho người khác.
    prefixed = [p for p in active if p.name.lower().startswith(needle)] if needle else []
    return prefixed[0] if len(prefixed) == 1 else None


def _entries_from(ctx: ToolContext, raw):
    if not isinstance(raw, list):
        return {"error": "Thiếu danh sách điểm."}

    entries: list[DraftEntry] = []
    for item in raw:
        name = str((item or {}).get("player", ""))
        player = _find_player(ctx, name)
        if player is None:
            return {"error": f'Không rõ "{name}" là ai.'}
        entries.append(DraftEntry(playerId=player.id, delta=int(item.get("delta", 0))))
    return {"entries": entries}


def _describe_entries(ctx: ToolContext, entries: list[DraftEntry]) -> str:
    """Mô tả ván bằng lời để đọc lên khi xin xác nhận."""
    names = {p.id: p.name for p in ctx.session.players}
    parts = sorted(entries, key=lambda e: -e.delta)
    return ", ".join(
        f"{names.get(e.playerId, '?')} {'+' if e.delta > 0 else ''}{e.delta}"
        for e in parts
    )


def _propose_entries(ctx: ToolContext, raw) -> list[ProposalRow] | None:
    """Ván đề xuất, dạng vẽ được lên thẻ xác nhận.

    Tham số model gửi sang không đọc được thì trả None — UI lùi về câu chữ chứ
    không vẽ thẻ rỗng.
    """
    parsed = _entries_from(ctx, raw)
    if "error" in parsed:
        return None
    names = {p.id: p.name for p in ctx.session.players}
    return [
        ProposalRow(playerId=e.playerId, name=names.get(e.playerId, "?"), delta=e.delta)
        for e in parsed["entries"]
    ]


ENTRIES_SCHEMA = {
    "type": "array",
    "description": "Điểm từng người trong ván. Tổng phải bằng 0.",
    "items": {
        "type": "object",
        "properties": {
            "player": {"type": "string", "description": "Tên người chơi"},
            "delta": {
                "type": "integer",
                "description": "Điểm cộng (dương) hoặc trừ (âm)",
            },
        },
        "required": ["player", "delta"],
    },
}

_seq = 0


def _next_request_id() -> str:
    """Khoá chống ghi trùng cho mỗi lần agent gọi record_round.

    Chỉ dùng thời gian thì hai ván ghi trong cùng một mili-giây mang chung khoá,
    và tool layer coi ván thứ hai là gửi lại của ván thứ nhất → nuốt mất một
    ván. Người nói không nhanh tới vậy, nhưng vòng ReAct thì có.
    """
    global _seq
    _seq += 1
    from datetime import datetime, timezone

    return f"agent-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{_seq}"


# ── Từng tool ──────────────────────────────────────────────────────────────


def _record_round(args, ctx: ToolContext) -> ToolResult:
    parsed = _entries_from(ctx, args.get("entries"))
    if "error" in parsed:
        return _fail(parsed["error"])

    result = ctx.tools.record_round(
        ctx.session.id,
        parsed["entries"],
        client_request_id=_next_request_id(),
        source="voice",
    )
    if not result.ok:
        return _fail(result.error.message)

    history = ctx.tools.get_history(ctx.session.id, limit=1).unwrap()["rounds"]
    seq = history[0].sequenceNo if history else None
    return _ok(
        {"recorded": True, "round": seq, "scoreboard": result.unwrap()["scoreboard"].dump()},
        changed=True,
    )


def _update_round(args, ctx: ToolContext) -> ToolResult:
    seq = int(args.get("round", 0))
    target = next(
        (r for r in ctx.session.rounds if r.sequenceNo == seq and r.status == "recorded"),
        None,
    )
    if target is None:
        return _fail(f"Không có ván {seq} đang hiệu lực.")

    parsed = _entries_from(ctx, args.get("entries"))
    if "error" in parsed:
        return _fail(parsed["error"])

    result = ctx.tools.update_round(
        ctx.session.id, target.id, parsed["entries"], source="voice"
    )
    if not result.ok:
        return _fail(result.error.message)
    return _ok(
        {"updated": True, "scoreboard": result.unwrap()["scoreboard"].dump()},
        changed=True,
    )


def _delete_round(args, ctx: ToolContext) -> ToolResult:
    raw = args.get("round")
    target = None
    if raw is not None:
        target = next(
            (
                r
                for r in ctx.session.rounds
                if r.sequenceNo == int(raw) and r.status == "recorded"
            ),
            None,
        )
        if target is None:
            return _fail(f"Không có ván {int(raw)} đang hiệu lực.")

    result = ctx.tools.undo_round(
        ctx.session.id, target.id if target else None, source="voice"
    )
    if not result.ok:
        return _fail(result.error.message)
    return _ok(
        {"deleted": True, "scoreboard": result.unwrap()["scoreboard"].dump()},
        changed=True,
    )


def _describe_delete(args, ctx: ToolContext) -> str:
    raw = args.get("round")
    if raw is None:
        recorded = [r for r in ctx.session.rounds if r.status == "recorded"]
        seq = max((r.sequenceNo for r in recorded), default=0)
    else:
        seq = int(raw)
    return f"Xóa ván {seq} nhé?"


def _undo(args, ctx: ToolContext) -> ToolResult:
    result = ctx.tools.undo_last(ctx.session.id)
    if not result.ok:
        return _fail(result.error.message)
    label = result.unwrap()["label"]
    return _ok({"label": label}, say=label, changed=True)


def _redo(args, ctx: ToolContext) -> ToolResult:
    result = ctx.tools.redo_last(ctx.session.id)
    if not result.ok:
        return _fail(result.error.message)
    label = result.unwrap()["label"]
    return _ok({"label": label}, say=label, changed=True)


def _get_scoreboard(args, ctx: ToolContext) -> ToolResult:
    board = compute_scoreboard(ctx.session)
    return _ok([{"name": r.name, "total": r.total, "rank": r.rank} for r in board.rows])


def _get_history(args, ctx: ToolContext) -> ToolResult:
    limit = 5 if args.get("limit") is None else int(args["limit"])
    names = {p.id: p.name for p in ctx.session.players}
    rounds = sorted(
        (r for r in ctx.session.rounds if r.status == "recorded"),
        key=lambda r: -r.sequenceNo,
    )[:limit]
    return _ok(
        [
            {
                "round": r.sequenceNo,
                "entries": [
                    {"name": names.get(e.playerId, "?"), "delta": e.delta}
                    for e in r.entries
                ],
            }
            for r in rounds
        ]
    )


def _add_player(args, ctx: ToolContext) -> ToolResult:
    name = str(args.get("name", ""))
    result = ctx.tools.add_player(ctx.session.id, name)
    if not result.ok:
        return _fail(result.error.message)
    return _ok({"added": name}, changed=True)


def _remove_player(args, ctx: ToolContext) -> ToolResult:
    who = str(args.get("player", ""))
    player = _find_player(ctx, who)
    if player is None:
        return _fail(f'Không rõ "{who}" là ai.')

    result = ctx.tools.remove_player(ctx.session.id, player.id)
    if not result.ok:
        return _fail(result.error.message)
    return _ok({"removed": player.name}, changed=True)


def _set_round_order(args, ctx: ToolContext) -> ToolResult:
    order = "newest-first" if str(args.get("order")) == "newest-first" else "newest-last"
    ctx.set_round_order(order)
    return _ok({"order": order}, changed=True)


def _set_confirm(args, ctx: ToolContext) -> ToolResult:
    enabled = bool(args.get("enabled"))
    result = ctx.tools.set_confirm_before_commit(ctx.session.id, enabled)
    if not result.ok:
        return _fail(result.error.message)
    return _ok({"enabled": enabled}, changed=True)


def _end_session(args, ctx: ToolContext) -> ToolResult:
    result = ctx.tools.end_session(ctx.session.id)
    if not result.ok:
        return _fail(result.error.message)
    return _ok({"ended": True}, changed=True)


def _remember(args, ctx: ToolContext) -> ToolResult:
    fact = ctx.memory.remember(str(args.get("fact", "")))
    return _ok({"remembered": fact.text}, say=f"Nhớ rồi: {fact.text}")


def _list_memory(args, ctx: ToolContext) -> ToolResult:
    return _ok([{"id": f.id, "text": f.text} for f in ctx.memory.facts()])


def _forget(args, ctx: ToolContext) -> ToolResult:
    needle = str(args.get("fact", "")).lower()
    target = next((f for f in ctx.memory.facts() if needle in f.text.lower()), None)
    if target is None:
        return _fail("Không nhớ điều đó nên không có gì để quên.")
    ctx.memory.forget(target.id)
    return _ok({"forgot": target.text}, say=f"Quên rồi: {target.text}")


AGENT_TOOLS: list[AgentTool] = [
    AgentTool(
        name="record_round",
        description=(
            "Ghi một ván mới. Chỉ gọi khi đã biết đủ điểm của từng người và "
            "tổng bằng 0."
        ),
        parameters={
            "type": "object",
            "properties": {"entries": ENTRIES_SCHEMA},
            "required": ["entries"],
        },
        run=_record_round,
        needs_confirm=lambda a, ctx: ctx.session.confirmBeforeCommit,
        describe=lambda a, ctx: (
            "Ghi ván này nhé?"
            if "error" in _entries_from(ctx, a.get("entries"))
            else f"{_describe_entries(ctx, _entries_from(ctx, a.get('entries'))['entries'])}. "
            "Ghi ván này nhé?"
        ),
        propose=lambda a, ctx: _propose_entries(ctx, a.get("entries")),
    ),
    AgentTool(
        name="update_round",
        description=(
            "Sửa điểm của một ván đã ghi. Cho số thứ tự ván và điểm mới của "
            "TẤT CẢ những người có điểm trong ván đó."
        ),
        parameters={
            "type": "object",
            "properties": {
                "round": {"type": "integer", "description": "Số thứ tự ván cần sửa"},
                "entries": ENTRIES_SCHEMA,
            },
            "required": ["round", "entries"],
        },
        run=_update_round,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: (
            ""
            if "error" in _entries_from(ctx, a.get("entries"))
            else f"{_describe_entries(ctx, _entries_from(ctx, a.get('entries'))['entries'])}. "
        )
        + f"Sửa ván {int(a.get('round', 0))} thành vậy nhé?",
        propose=lambda a, ctx: _propose_entries(ctx, a.get("entries")),
    ),
    AgentTool(
        name="delete_round",
        description="Xóa (hủy) một ván. Bỏ trống số ván thì hủy ván gần nhất.",
        parameters={
            "type": "object",
            "properties": {
                "round": {"type": "integer", "description": "Số thứ tự ván"}
            },
        },
        run=_delete_round,
        needs_confirm=lambda a, ctx: True,
        describe=_describe_delete,
    ),
    AgentTool(
        name="undo",
        description="Hoàn tác thao tác gần nhất (thêm, sửa hoặc xóa ván).",
        parameters={"type": "object", "properties": {}},
        run=_undo,
    ),
    AgentTool(
        name="redo",
        description="Làm lại thao tác vừa hoàn tác.",
        parameters={"type": "object", "properties": {}},
        run=_redo,
    ),
    AgentTool(
        name="get_scoreboard",
        description="Xem điểm tổng và thứ hạng hiện tại của cả làng.",
        parameters={"type": "object", "properties": {}},
        run=_get_scoreboard,
    ),
    AgentTool(
        name="get_history",
        description="Xem điểm chi tiết của các ván gần đây.",
        parameters={
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Số ván gần nhất"}
            },
        },
        run=_get_history,
    ),
    AgentTool(
        name="add_player",
        description="Thêm một người chơi mới vào phiên.",
        parameters={
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
        run=_add_player,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: f"Thêm {str(a.get('name', ''))} vào phiên nhé?",
    ),
    AgentTool(
        name="remove_player",
        description="Cho một người rời phiên. Các ván cũ của họ vẫn giữ nguyên.",
        parameters={
            "type": "object",
            "properties": {"player": {"type": "string"}},
            "required": ["player"],
        },
        run=_remove_player,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: f"Cho {str(a.get('player', ''))} rời phiên nhé?",
    ),
    AgentTool(
        name="set_round_order",
        description="Đổi thứ tự hiện ván trong bảng: mới nhất ở trên hay ở dưới.",
        parameters={
            "type": "object",
            "properties": {
                "order": {
                    "type": "string",
                    "enum": ["newest-last", "newest-first"],
                    "description": "newest-last = ván mới nhất ở dưới",
                }
            },
            "required": ["order"],
        },
        run=_set_round_order,
    ),
    AgentTool(
        name="set_confirm",
        description="Bật hoặc tắt việc hỏi xác nhận trước khi ghi điểm.",
        parameters={
            "type": "object",
            "properties": {"enabled": {"type": "boolean"}},
            "required": ["enabled"],
        },
        run=_set_confirm,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: (
            "Bật xác nhận trước khi ghi nhé?"
            if a.get("enabled")
            else "Tắt xác nhận trước khi ghi nhé?"
        ),
    ),
    AgentTool(
        name="end_session",
        description="Kết thúc phiên chơi và chốt tổng.",
        parameters={"type": "object", "properties": {}},
        run=_end_session,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: "Kết thúc phiên và chốt tổng nhé?",
    ),
    AgentTool(
        name="remember",
        description=(
            "Ghi nhớ lâu dài một điều về nhóm này: biệt danh, luật nhà, thói "
            "quen. Dùng khi người dùng bảo 'nhớ là...' hoặc khi học được điều "
            "sẽ hữu ích cho lần sau."
        ),
        parameters={
            "type": "object",
            "properties": {
                "fact": {"type": "string", "description": "Điều cần nhớ, một câu ngắn"}
            },
            "required": ["fact"],
        },
        run=_remember,
    ),
    AgentTool(
        name="list_memory",
        description="Xem những điều agent đang nhớ về nhóm này.",
        parameters={"type": "object", "properties": {}},
        run=_list_memory,
    ),
    AgentTool(
        name="forget",
        description="Quên một điều đã nhớ.",
        parameters={
            "type": "object",
            "properties": {
                "fact": {"type": "string", "description": "Nội dung điều cần quên"}
            },
            "required": ["fact"],
        },
        run=_forget,
        needs_confirm=lambda a, ctx: True,
        describe=lambda a, ctx: f"Quên \"{str(a.get('fact', ''))}\" nhé?",
    ),
]


def tool_by_name() -> dict[str, AgentTool]:
    return {t.name: t for t in AGENT_TOOLS}


def tool_declarations() -> list[dict]:
    """Khai báo gửi cho Gemini — chỉ tên, mô tả, schema."""
    return [
        {"name": t.name, "description": t.description, "parameters": t.parameters}
        for t in AGENT_TOOLS
    ]
