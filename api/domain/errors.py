"""Mã lỗi — hợp đồng ổn định, xem docs/product/tools.md.

Giữ NGUYÊN danh sách mã của bản TypeScript. Client đang phân biệt lỗi luật chơi
với lỗi hạ tầng dựa trên mã này; đổi ngôn ngữ backend không phải cớ để đổi
hợp đồng.

Mọi mã ở đây đều là "người dùng/luật chơi", không mã nào nghĩa là "máy hỏng" —
nên tầng route cho tất cả ra 400 (xem api/routes/sessions.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Literal, TypeVar

ErrorCode = Literal[
    "SESSION_NOT_FOUND",
    "SESSION_ENDED",
    "PLAYER_NOT_IN_SESSION",
    "TOO_FEW_PLAYERS",
    "TOO_MANY_PLAYERS",
    "SUM_DELTA_NOT_ZERO",
    "NEGATIVE_NOT_ALLOWED",
    "DUPLICATE_PLAYER_IN_ROUND",
    "EMPTY_ROUND",
    "ROUND_NOT_FOUND",
    "NO_ROUND_TO_UNDO",
]

T = TypeVar("T")


@dataclass(frozen=True)
class ToolError:
    code: ErrorCode
    message: str


@dataclass(frozen=True)
class Result(Generic[T]):
    """Kết quả có thể hỏng, không dùng exception cho lỗi luật chơi.

    Lý do giữ nguyên kiểu này thay vì raise: lỗi luật chơi là kết quả BÌNH
    THƯỜNG của tool layer (tổng chưa bằng 0 là chuyện xảy ra suốt), còn exception
    dành cho thứ thật sự hỏng. Trộn hai loại lại thì chỗ gọi phải bọc try/except
    quanh mọi thứ và không phân biệt được cái nào đáng báo động.
    """

    ok: bool
    data: T | None = None
    error: ToolError | None = None

    def unwrap(self) -> T:
        if not self.ok or self.data is None:
            raise AssertionError(f"unwrap trên Result hỏng: {self.error}")
        return self.data


def ok(data: T) -> Result[T]:
    return Result(ok=True, data=data)


def err(code: ErrorCode, message: str) -> Result:
    return Result(ok=False, error=ToolError(code=code, message=message))
