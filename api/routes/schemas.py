"""Hình dạng response — nguồn duy nhất sinh ra kiểu cho client (ADR 17).

Trước ADR 16, client và server dùng chung `shared/types.ts`: một định nghĩa duy
nhất cho `Session`, `Round`, `Scoreboard`. Đổi backend sang Python cắt đứt đường
đó. Khai tay hai bản thì sớm muộn cũng lệch, mà lệch kiểu này IM LẶNG — pytest
xanh, vitest xanh, chỉ người dùng thấy sai.

Nên các model ở đây không chỉ để FastAPI validate: chúng là bản gốc mà
`npm run gen:types` dịch thành `src/api/types.ts`.
"""

from __future__ import annotations

from typing import Literal, Union

from pydantic import Field
from typing_extensions import Annotated

from ..agent.types import ProposalRow
from ..domain.models import Base, RoundEvent, Scoreboard, Session


class SessionView(Base):
    """Phiên và bảng điểm luôn về cùng nhau — client KHÔNG tự tính điểm nữa."""

    session: Session
    scoreboard: Scoreboard


class ActiveView(Base):
    """`null` khi chưa có phiên nào đang chơi."""

    session: Session | None = None
    scoreboard: Scoreboard | None = None


class LabeledView(SessionView):
    #: "Đã hoàn tác thêm ván 3" — đọc lên cho người dùng nghe.
    label: str


class UndoState(Base):
    undo: str | None = None
    redo: str | None = None


class EventsView(Base):
    events: list[RoundEvent]


# ── Kết quả một lượt agent ──────────────────────────────────────────────────


class FinalOutcome(Base):
    type: Literal["final"]
    text: str


class ConfirmOutcome(Base):
    """Client CHỈ nhận được chừng này — không có tên tool, không có `call`.

    Lời gọi đang chờ nằm ở server (ADR 13) nên client không có đường nào tự chạy
    tool; nó chỉ trả lời có/không.
    """

    type: Literal["confirm"]
    prompt: str
    rows: list[ProposalRow] | None = None


class ClarifyOutcome(Base):
    type: Literal["clarify"]
    question: str


class ErrorOutcome(Base):
    type: Literal["error"]
    message: str
    retryable: bool


AgentOutcome = Annotated[
    Union[FinalOutcome, ConfirmOutcome, ClarifyOutcome, ErrorOutcome],
    Field(discriminator="type"),
]


class UiIntents(Base):
    """Việc client phải tự làm: thứ tự bảng là tuỳ chọn hiển thị (ADR 5)."""

    roundOrder: Literal["newest-last", "newest-first"] | None = None


class AgentReply(SessionView):
    outcome: AgentOutcome
    #: Agent nghĩ mấy bước — mỗi bước là một lượt gọi Gemini.
    steps: int
    uiIntents: UiIntents = Field(default_factory=UiIntents)


class ErrorDetail(Base):
    code: str
    message: str


class ErrorBody(Base):
    """Lỗi có mã, để UI phân biệt "nói sai luật" với "mất mạng"."""

    error: ErrorDetail
    retryable: bool
