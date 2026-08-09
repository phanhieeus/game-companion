"""Danh mục tool của agent.

Nguyên tắc: **agent làm được đúng những gì tay làm được** — không hơn, không
kém. Mỗi tool đi qua đúng tool layer đã có (decision 0001), nên validate
zero-sum, nhật ký, undo/redo dùng chung một đường, không có lối tắt.

`needs_confirm` khai ở đây chứ không để model tự quyết (ADR 12).
"""

from __future__ import annotations

from ..domain.models import DraftEntry
from ..domain.scoring import (
    compute_scoreboard,
    deltas_from_ranking,
    describe_house_rules,
    describe_missing,
    players_missing_from,
    rank_labels,
)
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
    return _rows_of(ctx, parsed["entries"])


def _rows_of(ctx: ToolContext, entries: list[DraftEntry]) -> list[ProposalRow]:
    names = {p.id: p.name for p in ctx.session.players}
    return [
        ProposalRow(playerId=e.playerId, name=names.get(e.playerId, "?"), delta=e.delta)
        for e in entries
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


def _commit(ctx: ToolContext, entries: list[DraftEntry]) -> ToolResult:
    """Cửa DUY NHẤT để một ván do agent đề xuất đi vào sổ.

    Chốt "ai không được nhắc tên thì phải hỏi lại" nằm ở ĐÂY, trong code, không
    phải trong prompt. Prompt khuyên được thì cũng quên được: đổi model, đổi câu
    chữ, hay chỉ là model hôm nay trả lời khác — lời khuyên bay mất, còn chốt
    này thì không. Đúng tinh thần ADR 12: model đề xuất, code quyết định.

    Vì sao gắt tới vậy: vắng tên KHÔNG phải là 0 điểm, nó là "chưa biết". Ghi 0
    cho người không được nhắc tên là kiểu sai tệ nhất app này có thể mắc — con
    số vào sổ, trông như thật, và không ai biết để mà cãi.
    """
    missing = players_missing_from(ctx.session, entries)
    if missing:
        return _fail(describe_missing(missing))

    result = ctx.tools.record_round(
        ctx.session.id,
        entries,
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


def _record_round(args, ctx: ToolContext) -> ToolResult:
    parsed = _entries_from(ctx, args.get("entries"))
    if "error" in parsed:
        return _fail(parsed["error"])
    return _commit(ctx, parsed["entries"])


def _ranking_ids(ctx: ToolContext, raw):
    """["Nam", "Lan", …] → id người chơi, xếp từ nhất xuống bét."""
    if raw is None:
        return {"ids": []}
    if not isinstance(raw, list):
        return {"error": "Thứ hạng phải là danh sách tên, từ nhất xuống bét."}

    ids: list[str] = []
    for item in raw:
        name = str(item or "")
        player = _find_player(ctx, name)
        if player is None:
            return {"error": f'Không rõ "{name}" là ai.'}
        ids.append(player.id)
    return {"ids": ids}


def _awards_from(ctx: ToolContext, raw):
    """[{bonus, player}] → cặp (tên thưởng, id người ăn)."""
    if raw is None:
        return {"awards": []}
    if not isinstance(raw, list):
        return {"error": "Thưởng phải là danh sách."}

    awards: list[tuple[str, str]] = []
    for item in raw:
        item = item or {}
        who = str(item.get("player", ""))
        player = _find_player(ctx, who)
        if player is None:
            return {"error": f'Không rõ "{who}" là ai.'}
        awards.append((str(item.get("bonus", "")), player.id))
    return {"awards": awards}


def _ranking_entries(args, ctx: ToolContext):
    """Thứ hạng + thưởng → điểm từng người, hoặc lý do không tính được."""
    ranking = _ranking_ids(ctx, args.get("ranking"))
    if "error" in ranking:
        return {"error": ranking["error"]}
    awards = _awards_from(ctx, args.get("bonuses"))
    if "error" in awards:
        return {"error": awards["error"]}

    result = deltas_from_ranking(ctx.session, ranking["ids"], awards["awards"])
    if not result.ok:
        return {"error": result.error.message}
    return {"entries": result.unwrap()}


def _record_ranking(args, ctx: ToolContext) -> ToolResult:
    """Ghi ván từ KẾT QUẢ ("Nam nhất, Lan nhì…") thay vì từ con số.

    Phép tra bảng hạng nằm trong `domain/scoring.py` chứ không để model tự cộng:
    model cộng sai thì không ai thấy, code cộng sai thì test đỏ.
    """
    parsed = _ranking_entries(args, ctx)
    if "error" in parsed:
        return _fail(parsed["error"])
    return _commit(ctx, parsed["entries"])


def _house_rules_patch(args, ctx: ToolContext):
    """Tham số model gửi sang → mẩu cấu hình đắp lên luật nhà đang có."""
    patch: dict = {}

    raw_points = args.get("rankPoints")
    if raw_points is not None:
        if not isinstance(raw_points, list) or not raw_points:
            return {"error": "Bảng hạng phải là dãy số, từ nhất xuống bét."}
        points: list[int] = []
        for value in raw_points:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return {"error": "Mỗi mức trong bảng hạng phải là một số."}
            points.append(int(value))
        patch["rankPoints"] = points

    raw_bonuses = args.get("bonuses")
    if raw_bonuses is not None:
        if not isinstance(raw_bonuses, list):
            return {"error": "Thưởng phải là danh sách."}
        bonuses = []
        for item in raw_bonuses:
            item = item or {}
            name = str(item.get("name", "")).strip()
            if not name:
                return {"error": "Thưởng phải có tên."}
            paid_by = "split" if str(item.get("paidBy")) == "split" else "each"
            bonuses.append(
                {"name": name, "points": int(item.get("points", 0)), "paidBy": paid_by}
            )
        patch["bonuses"] = bonuses

    if not patch:
        return {"error": "Chưa nói luật nào để đặt."}
    return {"patch": patch}


def _set_house_rules(args, ctx: ToolContext) -> ToolResult:
    """Đặt luật nhà BẰNG LỜI, đi đúng đường mà màn Cài đặt đi.

    Cùng một `update_scoring_config`, nên cùng một bộ kiểm: nói "nhất được 3
    điểm nhé" không thể lọt qua thứ mà bấm tay bị chặn.
    """
    parsed = _house_rules_patch(args, ctx)
    if "error" in parsed:
        return _fail(parsed["error"])

    result = ctx.tools.update_scoring_config(ctx.session.id, parsed["patch"])
    if not result.ok:
        return _fail(result.error.message)

    session = ctx.tools.repo.get(ctx.session.id)
    return _ok({"rules": describe_house_rules(session)}, changed=True)


def _describe_house_rules(args, ctx: ToolContext) -> str:
    parsed = _house_rules_patch(args, ctx)
    if "error" in parsed:
        return "Đặt luật nhà nhé?"

    parts: list[str] = []
    points = parsed["patch"].get("rankPoints")
    if points:
        labels = rank_labels(len(points))
        parts.append(
            ", ".join(
                f"{label} {'+' if p > 0 else ''}{p}" for label, p in zip(labels, points)
            )
        )
    for bonus in parsed["patch"].get("bonuses", []):
        how = "mỗi người còn lại chung đủ" if bonus["paidBy"] == "each" else "chia đều"
        parts.append(f"\"{bonus['name']}\" {bonus['points']} điểm, {how}")
    return f"Đặt luật nhà: {'; '.join(parts)}. Đúng chưa?"


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
        name="record_ranking",
        description=(
            "Ghi một ván theo LUẬT NHÀ: cho thứ hạng của TẤT CẢ người đang chơi "
            "(từ nhất xuống bét) và/hoặc ai ăn khoản thưởng nào. App tự tra "
            "bảng điểm của phiên rồi tính ra điểm từng người — đừng tự cộng "
            "trừ. Dùng tool này khi người nói chỉ nói kết quả: \"Nam nhất, Lan "
            "nhì, Hùng ba, Tú bét\", \"Nam ăn tứ quý\"."
        ),
        parameters={
            "type": "object",
            "properties": {
                "ranking": {
                    "type": "array",
                    "description": (
                        "Tên người chơi xếp từ nhất xuống bét. Phải có ĐỦ mọi "
                        "người đang chơi, thiếu một người là không ghi được."
                    ),
                    "items": {"type": "string"},
                },
                "bonuses": {
                    "type": "array",
                    "description": "Ai ăn khoản thưởng nào trong ván này.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "bonus": {
                                "type": "string",
                                "description": "Tên khoản thưởng trong luật nhà",
                            },
                            "player": {"type": "string", "description": "Người ăn"},
                        },
                        "required": ["bonus", "player"],
                    },
                },
            },
        },
        run=_record_ranking,
        needs_confirm=lambda a, ctx: ctx.session.confirmBeforeCommit,
        describe=lambda a, ctx: (
            "Ghi ván này nhé?"
            if "error" in _ranking_entries(a, ctx)
            else f"{_describe_entries(ctx, _ranking_entries(a, ctx)['entries'])}. "
            "Ghi ván này nhé?"
        ),
        propose=lambda a, ctx: (
            None
            if "error" in _ranking_entries(a, ctx)
            else _rows_of(ctx, _ranking_entries(a, ctx)["entries"])
        ),
    ),
    AgentTool(
        name="set_house_rules",
        description=(
            "Đặt luật tính điểm của nhà: điểm theo thứ hạng (từ nhất xuống bét, "
            "phải đủ số mức bằng số người đang chơi) và các khoản thưởng. Dùng "
            "khi người dùng nói luật, ví dụ \"nhất được 3, nhì 1, ba trừ 1, bét "
            "trừ 3\" hoặc \"tứ quý 5 điểm mỗi người chung\". Danh sách thưởng "
            "gửi lên sẽ THAY THẾ danh sách cũ."
        ),
        parameters={
            "type": "object",
            "properties": {
                "rankPoints": {
                    "type": "array",
                    "description": "Điểm từ nhất xuống bét, ví dụ [3, 1, -1, -3]",
                    "items": {"type": "integer"},
                },
                "bonuses": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": 'Ví dụ "tứ quý"'},
                            "points": {"type": "integer"},
                            "paidBy": {
                                "type": "string",
                                "enum": ["each", "split"],
                                "description": (
                                    "each = mỗi người còn lại chung đủ; "
                                    "split = những người kia chia đều"
                                ),
                            },
                        },
                        "required": ["name", "points", "paidBy"],
                    },
                },
            },
        },
        run=_set_house_rules,
        needs_confirm=lambda a, ctx: True,
        describe=_describe_house_rules,
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
