"""Vòng ReAct: nghĩ → làm → nhìn kết quả → nghĩ tiếp."""

from __future__ import annotations

import time

from .tools import tool_by_name
from .types import AgentMessage, ModelReply, ProposalRow, StepResult, ToolCall, ToolContext

#: Trần cứng số bước ReAct (ADR 11).
#:
#: Mỗi bước là MỘT lượt gọi Gemini. Free tier có hạn và đã sập một lần rồi
#: (20 lượt/ngày trên model cũ). Vòng lặp không trần có thể đốt sạch quota chỉ
#: vì một câu nói làm model loanh quanh.
MAX_STEPS = 5


async def _call_model(ctx: ToolContext, messages: list[AgentMessage]) -> ModelReply:
    started = time.monotonic()
    try:
        reply = await ctx.model(messages)
    except Exception:
        # Hàm model tự dịch lỗi của nó rồi; tới đây là hỏng ngoài dự tính.
        reply = ModelReply(
            error="Trợ lý đang trục trặc, thử lại giúp nhé.", retryable=True
        )

    if ctx.tracer:
        ctx.tracer.model_replied(
            text=reply.text or reply.error,
            tool=reply.call.name if reply.call else None,
            args=reply.call.args if reply.call else None,
            ms=int((time.monotonic() - started) * 1000),
        )
    return reply


def _run_tool(call: ToolCall, ctx: ToolContext):
    """Chạy tool và ghi kết quả vào hội thoại.

    Kết quả tool được đưa NGƯỢC lại cho model ở bước sau — đó chính là chữ
    "observe" trong ReAct. Nhờ vậy agent làm được việc nhiều bước: hỏi bảng điểm
    rồi mới quyết ghi bao nhiêu, hoặc sửa xong rồi đọc lại xác nhận.
    """
    tool = tool_by_name().get(call.name)
    started = time.monotonic()

    if tool is None:
        from .types import ToolResult

        result = ToolResult(
            ok=False, data={"error": f"Không có công cụ {call.name}."}, changed=False
        )
        if ctx.tracer:
            ctx.tracer.note("unknown_tool", {"name": call.name})
    else:
        result = tool.run(call.args, ctx)

    if ctx.tracer:
        ctx.tracer.tool_ran(
            name=call.name,
            args=call.args,
            result=result.data,
            ms=int((time.monotonic() - started) * 1000),
        )
    return result


def needs_confirm(call: ToolCall, ctx: ToolContext) -> dict | None:
    """Tool này có cần người chốt trước khi chạy không (ADR 12).

    Trả về cả câu hỏi lẫn các dòng số để vẽ thẻ đề xuất — cả hai đều do TOOL
    khai, không do model soạn.
    """
    tool = tool_by_name().get(call.name)
    if tool is None or tool.needs_confirm is None:
        return None
    if not tool.needs_confirm(call.args, ctx):
        return None

    prompt = tool.describe(call.args, ctx) if tool.describe else f"{call.name} nhé?"
    rows: list[ProposalRow] | None = (
        tool.propose(call.args, ctx) if tool.propose else None
    )
    return {"prompt": prompt, "rows": rows}


async def run_agent(user_text: str, ctx: ToolContext) -> StepResult:
    """Một lượt agent: nghĩ → làm → nhìn kết quả → nghĩ tiếp, tối đa MAX_STEPS.

    Dừng khi model trả về câu chữ (xong), hoặc khi gặp tool cần người chốt — lúc
    đó trả về "confirm" và nhường quyền cho người dùng.
    """
    ctx.memory.append_turn(AgentMessage(role="user", text=user_text))
    return await _loop(ctx, False)


async def resume_agent(call: ToolCall, accepted: bool, ctx: ToolContext) -> StepResult:
    """Chạy tiếp sau khi người dùng đã chốt một tool."""
    if not accepted:
        ctx.memory.append_turn(
            AgentMessage(
                role="tool",
                name=call.name,
                result={"ok": False, "data": {"error": "Người dùng từ chối."}},
            )
        )
        return StepResult(
            outcome={"type": "final", "text": "Được, bỏ qua."}, changed=False, steps=0
        )

    result = _run_tool(call, ctx)
    ctx.memory.append_turn(
        AgentMessage(role="tool", name=call.name, result=result.data)
    )

    # Tool tự nói được thì khỏi tốn thêm một lượt gọi model chỉ để diễn đạt lại.
    if result.say:
        return StepResult(
            outcome={"type": "final", "text": result.say},
            changed=result.changed,
            steps=0,
        )

    nxt = await _loop(ctx, result.changed)
    nxt.changed = result.changed or nxt.changed
    return nxt


async def _loop(ctx: ToolContext, changed_so_far: bool) -> StepResult:
    changed = changed_so_far

    for step in range(MAX_STEPS):
        if ctx.tracer:
            ctx.tracer.begin_step()
        reply = await _call_model(ctx, ctx.memory.turns())

        if reply.error:
            return StepResult(
                outcome={
                    "type": "error",
                    "message": reply.error,
                    "retryable": reply.retryable,
                },
                changed=changed,
                steps=step + 1,
            )

        if reply.call:
            ctx.memory.append_turn(AgentMessage(role="model", call=reply.call))

            confirm = needs_confirm(reply.call, ctx)
            if confirm:
                if ctx.tracer:
                    ctx.tracer.note(
                        "hitl_confirm_required",
                        {"tool": reply.call.name, "prompt": confirm["prompt"]},
                    )
                # Nhường quyền cho người. Vòng lặp dừng ở đây, không tự ý ghi.
                return StepResult(
                    outcome={
                        "type": "confirm",
                        "prompt": confirm["prompt"],
                        "rows": confirm["rows"],
                        "call": reply.call,
                    },
                    changed=changed,
                    steps=step + 1,
                )

            result = _run_tool(reply.call, ctx)
            changed = changed or result.changed
            ctx.memory.append_turn(
                AgentMessage(role="tool", name=reply.call.name, result=result.data)
            )

            if result.say:
                return StepResult(
                    outcome={"type": "final", "text": result.say},
                    changed=changed,
                    steps=step + 1,
                )
            continue  # observe → nghĩ tiếp

        text = (reply.text or "").strip()
        if text:
            ctx.memory.append_turn(AgentMessage(role="model", text=text))
            return StepResult(
                outcome={"type": "final", "text": text}, changed=changed, steps=step + 1
            )

        return StepResult(
            outcome={"type": "clarify", "question": "Mình chưa rõ ý, nói lại giúp nhé."},
            changed=changed,
            steps=step + 1,
        )

    # Chạm trần: dừng và nói thật, đừng im lặng giả vờ xong.
    if ctx.tracer:
        ctx.tracer.note("max_steps_reached", {"limit": MAX_STEPS})
    return StepResult(
        outcome={
            "type": "error",
            "message": "Việc này nhiều bước quá, mình chưa làm xong. "
            "Thử tách thành từng câu ngắn hơn nhé.",
            "retryable": False,
        },
        changed=changed,
        steps=MAX_STEPS,
    )
