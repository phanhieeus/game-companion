"""Ghi vết một lượt agent (C-022).

Agent là hộp đen: nói một câu, ván hiện ra, không ai biết ở giữa nó nghĩ gì. Đang
giai đoạn phát triển thì đó là thứ đắt nhất — mỗi lần agent làm sai phải đoán.

Nguyên tắc của cả file này: **quan sát không được phép làm hỏng thứ nó quan
sát**. Mọi lỗi khi ghi vết đều bị nuốt. Mất một dòng log còn hơn mất một ván bài.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from .guardrails import GuardrailHit

#: Giữ bao nhiêu lượt gần nhất mỗi phiên. Đủ soi trọn một buổi chơi, mà CSDL
#: free không phình tới lúc đứt.
MAX_TURNS_PER_SESSION = 200


@dataclass
class TraceStep:
    """Một bước trong vòng ReAct: nghĩ → làm → nhìn kết quả."""

    index: int
    #: Model nói gì bằng chữ (phần "thought" — Gemini không trả thought riêng,
    #: nên đây là chữ nó viết ra khi không gọi tool).
    thought: str | None = None
    #: Gọi tool nào, tham số gì (phần "action").
    tool: str | None = None
    args: dict | None = None
    #: Tool trả về gì (phần "observation") — KẾT QUẢ THẬT, không phải tóm tắt.
    observation: Any = None
    #: Prompt hệ thống đã gửi ở bước này. Nó đổi theo roster và trí nhớ nên
    #: không suy ngược được — phải lưu thật.
    prompt: str | None = None
    model_ms: int | None = None
    tool_ms: int | None = None


@dataclass
class TraceTurn:
    """Một lượt nói, từ lúc người dùng mở miệng tới lúc agent dừng."""

    id: str
    sessionId: str
    deviceId: str | None
    at: str
    text: str
    steps: list[TraceStep] = field(default_factory=list)
    guardrails: list[dict] = field(default_factory=list)
    outcome: str | None = None
    outcomeDetail: dict | None = None
    totalMs: int | None = None

    def dump(self) -> dict:
        return {
            "id": self.id,
            "sessionId": self.sessionId,
            "deviceId": self.deviceId,
            "at": self.at,
            "text": self.text,
            "steps": [
                {
                    "index": s.index,
                    "thought": s.thought,
                    "tool": s.tool,
                    "args": s.args,
                    "observation": s.observation,
                    "prompt": s.prompt,
                    "modelMs": s.model_ms,
                    "toolMs": s.tool_ms,
                }
                for s in self.steps
            ],
            "guardrails": self.guardrails,
            "outcome": self.outcome,
            "outcomeDetail": self.outcomeDetail,
            "totalMs": self.totalMs,
        }


class TraceStore(Protocol):
    def append(self, turn: TraceTurn) -> None: ...
    def list(self, session_id: str, limit: int = 50) -> list[dict]: ...
    def sessions(self, limit: int = 50) -> list[dict]: ...
    def stats(self) -> dict: ...


class Tracer:
    """Bám theo đúng MỘT lượt nói.

    Tạo mới mỗi lượt, nên không có state dùng chung giữa các request — hai người
    nói cùng lúc không lẫn vết của nhau.
    """

    def __init__(
        self,
        store: TraceStore | None,
        *,
        turn_id: str,
        session_id: str,
        device_id: str | None,
        at: str,
        text: str,
    ) -> None:
        self.store = store
        self.turn = TraceTurn(
            id=turn_id,
            sessionId=session_id,
            deviceId=device_id,
            at=at,
            text=text,
        )
        self._t0 = time.monotonic()
        self._current: TraceStep | None = None

    # ── Trong lúc chạy ──────────────────────────────────────────────────

    def begin_step(self) -> TraceStep:
        step = TraceStep(index=len(self.turn.steps))
        self.turn.steps.append(step)
        self._current = step
        return step

    def set_prompt(self, prompt: str) -> None:
        """Prompt chỉ dựng được NGAY TRƯỚC khi gọi model, không phải lúc mở bước.

        Đặt ở `begin_step` thì bước 0 luôn rỗng còn bước 1 mang prompt của bước
        trước — lệch một nhịp, và đọc log sẽ hiểu sai agent đã thấy gì.
        """
        step = self._current or self.begin_step()
        step.prompt = prompt

    def model_replied(self, *, text: str | None, tool: str | None, args: dict | None,
                      ms: int) -> None:
        step = self._current or self.begin_step()
        step.thought = text
        step.tool = tool
        step.args = args
        step.model_ms = ms

    def tool_ran(self, *, name: str, result: Any, ms: int) -> None:
        step = self._current or self.begin_step()
        step.tool = step.tool or name
        step.observation = result
        step.tool_ms = ms

    def guardrail(self, hit: GuardrailHit) -> None:
        self.turn.guardrails.append(
            {"name": hit.name, "message": hit.message, "detail": hit.detail}
        )

    def note(self, name: str, detail: dict | None = None) -> None:
        """Chốt không phải guardrail-chặn nhưng vẫn đáng ghi: HITL, chạm trần…"""
        self.turn.guardrails.append(
            {"name": name, "message": "", "detail": detail or {}}
        )

    # ── Kết thúc ────────────────────────────────────────────────────────

    def finish(self, outcome: dict) -> None:
        self.turn.outcome = str(outcome.get("type"))
        self.turn.outcomeDetail = {
            k: v for k, v in outcome.items() if k in ("text", "prompt", "message",
                                                      "question", "retryable")
        }
        self.turn.totalMs = int((time.monotonic() - self._t0) * 1000)

        if self.store is None:
            return
        try:
            self.store.append(self.turn)
        except Exception:
            # Quan sát không được phép làm hỏng thứ nó quan sát.
            pass
