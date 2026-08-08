"""Mini-agent: các mảnh một agent cần có.

  Tool     — việc agent làm được, bằng đúng những gì tay làm được
  ReAct    — vòng nghĩ → làm → nhìn kết quả → nghĩ tiếp
  HITL     — người chốt trước khi điểm vào sổ
  Memory   — nhớ trong lượt (hội thoại) và nhớ lâu (thói quen, biệt danh)

Toàn bộ chạy ở SERVER (ADR 13): tool nằm cùng chỗ với dữ liệu phiên, nên không
phải đẩy state qua lại. Client chỉ gửi một câu nói và nhận kết quả.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Protocol

from ..domain.models import Base, Session
from ..tools import Tools

RoundOrder = Literal["newest-last", "newest-first"]


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any] = field(default_factory=dict)
    #: Chữ ký "suy nghĩ" Gemini gắn kèm mỗi lần gọi tool.
    #:
    #: Không dùng để làm gì cả — chỉ giữ hộ rồi trả lại NGUYÊN VẸN ở lượt sau.
    #: Thiếu nó thì Gemini 3.x từ chối cả request (400), tức vòng ReAct chết
    #: đúng ở bước thứ hai. Bản TypeScript đã trả giá một lần cho chỗ này.
    thought_signature: str | None = None


@dataclass
class AgentMessage:
    """Một lượt trong hội thoại gửi cho model."""

    role: Literal["user", "model", "tool"]
    text: str | None = None
    call: ToolCall | None = None
    name: str | None = None
    result: Any = None


@dataclass
class ModelReply:
    """Model trả về: gọi tool tiếp, câu trả lời, hay lỗi."""

    text: str | None = None
    call: ToolCall | None = None
    error: str | None = None
    retryable: bool = True


class ProposalRow(Base):
    """Một dòng trong thẻ đề xuất: ai, bao nhiêu điểm."""

    playerId: str
    name: str
    delta: int


@dataclass
class ToolResult:
    ok: bool
    #: Trả về cho model đọc ở bước tiếp theo.
    data: Any = None
    #: Câu ngắn cho người dùng, nếu tool muốn nói gì đó ngay.
    say: str | None = None
    #: Dữ liệu phiên đã đổi — UI phải vẽ lại.
    changed: bool = False


class MemoryStore(Protocol):
    def facts(self) -> list: ...
    def remember(self, text: str): ...
    def forget(self, fact_id: str) -> None: ...
    def turns(self) -> list[AgentMessage]: ...
    def append_turn(self, message: AgentMessage) -> None: ...
    def clear_turns(self) -> None: ...


@dataclass
class ToolContext:
    """Ngữ cảnh mà tool được chạy trong đó."""

    session: Session
    tools: Tools
    memory: MemoryStore
    #: Gọi model — TIÊM VÀO chứ không để vòng lặp tự đi gọi.
    #:
    #: Vòng lặp ReAct không cần biết Gemini tồn tại, càng không cần biết HTTP.
    #: Nhờ vậy test chỉ đưa vào một hàm giả, không phải giả lập tầng mạng; và
    #: đổi nhà cung cấp model sau này chỉ đụng `gemini.py`.
    model: Callable[[list[AgentMessage]], Any]
    #: Thứ tự bảng là tuỳ chọn HIỂN THỊ của client (ADR 5), server không giữ.
    #: Tool chỉ ghi lại ý định; client đọc `uiIntents` rồi tự áp.
    set_round_order: Callable[[str], None] = lambda order: None
    #: Ghi vết (C-022). Tuỳ chọn: không có thì agent chạy y hệt như cũ, nên test
    #: vòng lặp không phải dựng thêm gì và tracing không đổi được hành vi.
    tracer: Any = None
    #: Prompt hệ thống của lượt gọi model gần nhất, để tracer chép lại. Do
    #: `routes/agent.py` đặt vào — vòng lặp không biết prompt trông thế nào.
    last_prompt: str | None = None


@dataclass
class AgentTool:
    name: str
    description: str
    #: JSON Schema rút gọn theo dạng Gemini nhận.
    parameters: dict
    run: Callable[[dict, ToolContext], ToolResult]
    #: Cần người xác nhận trước khi chạy.
    #:
    #: Khai báo ở TOOL chứ không để model tự quyết (ADR 12): model chỉ đề xuất,
    #: code quyết định. Đổi prompt hay đổi model không được phép làm mất chốt.
    needs_confirm: Callable[[dict, ToolContext], bool] | None = None
    #: Câu đọc lên để xin xác nhận.
    describe: Callable[[dict, ToolContext], str] | None = None
    #: Các dòng số hiện lên lúc xin xác nhận — T của T·C·R.
    #:
    #: Nghe "Hùng trừ một" giữa lúc ồn ào rất dễ trôi; nhìn thấy "Hùng −1" thì
    #: sai là biết ngay. Khai ở TOOL cùng lý do với `needs_confirm`.
    propose: Callable[[dict, ToolContext], list[ProposalRow] | None] | None = None


@dataclass
class StepResult:
    outcome: dict
    #: Có tool nào đổi dữ liệu không — UI phải vẽ lại.
    changed: bool = False
    #: Số lượt gọi Gemini đã dùng, để hiện lên cho người dùng biết.
    steps: int = 0
