"""Bộ nhớ hai tầng.

- **Nhớ lâu** (`facts`): thói quen và luật nhà học được, sống qua nhiều phiên,
  cất qua `FactStore` và được nhét vào system prompt. Ví dụ: "Hùng hay bị nghe
  nhầm thành Hùn", "nhà này tính 3 điểm cho ù".
- **Nhớ trong lượt** (`turns`): hội thoại của phiên hiện tại, để hiểu câu nói
  tham chiếu ngược ("còn Lan thì sao?"). Chỉ nằm trong RAM, mất khi khởi động
  lại.

Tách hai tầng vì chúng có vòng đời khác hẳn nhau: một cái là kiến thức, một cái
là ngữ cảnh. Gộp lại thì hoặc quên mất kiến thức, hoặc mang theo cả đống hội
thoại cũ không liên quan.
"""

from __future__ import annotations

import json
import random
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from ..domain.models import Base
from .types import AgentMessage

MAX_FACTS = 20
#: Giữ đủ ngữ cảnh để hiểu "còn Hùng thì sao", nhưng không đốt token vô hạn.
MAX_TURNS = 12


class MemoryFact(Base):
    id: str
    text: str
    at: str


class FactStore(Protocol):
    """Chỗ cất "nhớ lâu" — tách ra thành cổng vì mỗi môi trường cất một kiểu.

    Đọc/ghi hỏng thì NUỐT lỗi và coi như rỗng: quên vài thói quen còn hơn là cả
    trợ lý không nói được câu nào.
    """

    def read(self) -> list[MemoryFact]: ...
    def write(self, facts: list[MemoryFact]) -> None: ...


class InMemoryFactStore:
    """Không cất gì cả — dùng cho test và khi chưa cấu hình chỗ lưu."""

    def __init__(self) -> None:
        self._facts: list[MemoryFact] = []

    def read(self) -> list[MemoryFact]:
        return list(self._facts)

    def write(self, facts: list[MemoryFact]) -> None:
        self._facts = list(facts)


class FileFactStore:
    """Nhớ lâu ghi xuống JSON — cùng chính sách "hỏng thì rỗng" như kho phiên."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def read(self) -> list[MemoryFact]:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            return [MemoryFact.model_validate(f) for f in raw]
        except Exception:
            return []

    def write(self, facts: list[MemoryFact]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps([f.dump() for f in facts], ensure_ascii=False, indent=2),
            "utf-8",
        )


class Memory:
    def __init__(self, store: FactStore | None = None) -> None:
        self.store: FactStore = store or InMemoryFactStore()
        self._turns: list[AgentMessage] = []

    def _load(self) -> list[MemoryFact]:
        try:
            return self.store.read()
        except Exception:
            return []

    def _save(self, facts: list[MemoryFact]) -> None:
        try:
            self.store.write(facts)
        except Exception:
            # Ghi hỏng thì trợ lý vẫn chạy, chỉ là quên sau khi tắt.
            pass

    def facts(self) -> list[MemoryFact]:
        return self._load()

    def remember(self, text: str) -> MemoryFact:
        trimmed = text.strip()
        facts = self._load()

        # Trùng ý thì bỏ qua, đừng để agent nhớ mười lần cùng một điều.
        existing = next(
            (f for f in facts if f.text.lower() == trimmed.lower()), None
        )
        if existing:
            return existing

        suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
        fact = MemoryFact(
            id=f"fact_{int(datetime.now(timezone.utc).timestamp() * 1000):x}{suffix}",
            text=trimmed,
            at=datetime.now(timezone.utc).isoformat(),
        )
        # Quá hạn mức thì bỏ cái cũ nhất — bộ nhớ hữu hạn phải có chính sách.
        self._save([*facts, fact][-MAX_FACTS:])
        return fact

    def forget(self, fact_id: str) -> None:
        self._save([f for f in self._load() if f.id != fact_id])

    def turns(self) -> list[AgentMessage]:
        return self._turns

    def append_turn(self, message: AgentMessage) -> None:
        self._turns = [*self._turns, message][-MAX_TURNS:]

    def clear_turns(self) -> None:
        self._turns = []


def create_memory(store: FactStore | None = None) -> Memory:
    return Memory(store)
