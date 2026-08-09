"""Bộ nhớ hai tầng, cả hai đều THUỘC VỀ MỘT PHIÊN (C-027).

- **Nhớ lâu** (`facts`): thói quen và luật nhà học được, cất qua `FactStore` và
  được nhét vào system prompt. Ví dụ: "Hùng hay bị nghe nhầm thành Hùn", "nhà
  này tính 3 điểm cho ù".
- **Nhớ trong lượt** (`turns`): hội thoại gần đây, để hiểu câu nói tham chiếu
  ngược ("còn Lan thì sao?"). Cất qua `TurnStore`.

Operator đã chốt: **agent chỉ cần nhớ trong phiên; phiên mới không cần nhớ phiên
cũ.** Trước C-027 nhớ lâu dùng chung TOÀN CỤC — luật nhà của bàn này áp sang bàn
khác, và trần 20 điều là trần toàn cục nên nhóm nói nhiều đẩy luật nhóm kia ra,
im lặng. Giờ cả hai tầng khoá theo `session_id`, `MAX_FACTS`/`MAX_TURNS` là trần
MỖI PHIÊN, và hết phiên thì dọn cả hai.

Vẫn tách làm hai tầng dù vòng đời đã bằng nhau, vì hạn mức của chúng khác nhau:
nhớ lâu sống qua cửa sổ 12 lượt mà `turns` không sống qua. "Nhà này tính 3 điểm
cho ù" nói ở ván 1 phải còn tác dụng ở ván 30; gộp lại thì hoặc quên mất luật
nhà, hoặc phải mang theo cả đống hội thoại cũ không liên quan.
"""

from __future__ import annotations

import json
import os
import random
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from ..domain.models import Base
from ..repository.turns import InMemoryTurnStore, TurnStore
from .types import AgentMessage

#: Trần MỖI PHIÊN, không phải trần toàn cục — xem docstring đầu file.
MAX_FACTS = 20
#: Giữ đủ ngữ cảnh để hiểu "còn Hùng thì sao", nhưng không đốt token vô hạn.
#: Cũng là trần mỗi phiên.
MAX_TURNS = 12


class MemoryFact(Base):
    id: str
    text: str
    at: str


class FactStore(Protocol):
    """Chỗ cất "nhớ lâu" — tách ra thành cổng vì mỗi môi trường cất một kiểu.

    Mọi phép đều mang `session_id`: nhớ lâu thuộc về đúng một bàn chơi, không
    còn dùng chung nữa (C-027).

    Đọc/ghi hỏng thì NUỐT lỗi và coi như rỗng: quên vài thói quen còn hơn là cả
    trợ lý không nói được câu nào.
    """

    def read(self, session_id: str) -> list[MemoryFact]: ...
    def write(self, session_id: str, facts: list[MemoryFact]) -> None: ...
    def clear(self, session_id: str) -> None: ...


class InMemoryFactStore:
    """Không cất gì cả — dùng cho test và khi chưa cấu hình chỗ lưu."""

    def __init__(self) -> None:
        self._by_session: dict[str, list[MemoryFact]] = {}

    def read(self, session_id: str) -> list[MemoryFact]:
        return list(self._by_session.get(session_id, []))

    def write(self, session_id: str, facts: list[MemoryFact]) -> None:
        self._by_session[session_id] = list(facts)

    def clear(self, session_id: str) -> None:
        self._by_session.pop(session_id, None)


class FileFactStore:
    """Nhớ lâu ghi xuống JSON — cùng chính sách "hỏng thì rỗng" như kho phiên.

    File là một object `{session_id: [fact, ...]}`. Bản cũ ghi thẳng một mảng
    dùng chung; đọc phải file cũ thì `_load` trả về rỗng và mọi phiên bắt đầu
    lại từ trắng — đúng thứ operator đã chốt, chứ không phải mất mát ngoài ý.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _load(self) -> dict[str, list[dict]]:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            return raw if isinstance(raw, dict) else {}
        except Exception:
            return {}

    def _save(self, data: dict[str, list[dict]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Ghi file tạm rồi đổi tên: bị giết giữa chừng thì file cũ còn nguyên.
        temp = self.path.with_suffix(self.path.suffix + ".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
        os.replace(temp, self.path)

    def read(self, session_id: str) -> list[MemoryFact]:
        try:
            return [
                MemoryFact.model_validate(f) for f in self._load().get(session_id, [])
            ]
        except Exception:
            return []

    def write(self, session_id: str, facts: list[MemoryFact]) -> None:
        data = self._load()
        data[session_id] = [f.dump() for f in facts]
        self._save(data)

    def clear(self, session_id: str) -> None:
        data = self._load()
        if data.pop(session_id, None) is not None:
            self._save(data)


def trim_window(turns: list[AgentMessage]) -> list[AgentMessage]:
    """Cắt hội thoại về hạn mức mà KHÔNG cắt đôi một cặp gọi tool.

    Gemini đòi hội thoại đúng hình dạng: `functionCall` phải đứng ngay sau lượt
    người dùng hoặc sau một `functionResponse`; `functionResponse` phải đứng ngay
    sau `functionCall`. Cắt thẳng `turns[-12:]` có thể để lại một
    `functionResponse` mồ côi ở đầu, và Gemini từ chối CẢ request với 400 —
    người dùng thấy "Gemini trả lỗi 400" mà chẳng làm gì sai.

    Lỗi này đã xảy ra thật trên production (11 lần, 2026-08-08). Nó không ngẫu
    nhiên: nói đủ nhiều trong một phiên là chắc chắn gặp.

    Cách sửa: sau khi cắt, lùi mép trái tới lượt NGƯỜI DÙNG gần nhất — chỉ chỗ đó
    mới là điểm bắt đầu hợp lệ. Thà mất thêm vài lượt ngữ cảnh còn hơn gửi lên
    một hội thoại sai hình dạng.
    """
    window = turns[-MAX_TURNS:]
    for index, message in enumerate(window):
        if message.role == "user":
            return window[index:]
    # Cả cửa sổ không còn lượt người dùng nào (chuỗi tool dài hơn hạn mức):
    # bắt đầu lại từ trống còn hơn gửi lên thứ Gemini chắc chắn từ chối.
    return []


def is_well_formed(turns: list[AgentMessage]) -> bool:
    """Hội thoại có đúng hình dạng Gemini đòi không.

    Tách riêng để test soi được, và để chỗ nào nghi ngờ thì gọi kiểm tra thay vì
    đoán bằng mắt.
    """
    previous: AgentMessage | None = None
    for message in turns:
        if message.role == "tool":
            if previous is None or previous.role != "model" or previous.call is None:
                return False
        if message.role == "model" and message.call is not None:
            if previous is not None and previous.role not in ("user", "tool"):
                return False
        previous = message
    return True


#: Phiên mặc định cho những chỗ dựng `Memory` mà không quan tâm phạm vi (test
#: vòng lặp, test tool). Đặt tên rõ ràng để nếu nó lỡ rò ra production thì nhìn
#: dữ liệu là biết ngay chỗ nào quên truyền `session_id`.
FALLBACK_SESSION = "phien-khong-ten"


class Memory:
    """Trí nhớ của ĐÚNG MỘT phiên. Hai tầng, hai kho, chung một `session_id`."""

    def __init__(
        self,
        session_id: str = FALLBACK_SESSION,
        store: FactStore | None = None,
        turn_store: TurnStore | None = None,
    ) -> None:
        self.session_id = session_id
        self.store: FactStore = store or InMemoryFactStore()
        self.turn_store: TurnStore = turn_store or InMemoryTurnStore()

    def _load(self) -> list[MemoryFact]:
        try:
            return self.store.read(self.session_id)
        except Exception:
            return []

    def _save(self, facts: list[MemoryFact]) -> None:
        try:
            self.store.write(self.session_id, facts)
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
        """Hội thoại đã sẵn sàng gửi lên Gemini, kể cả khi vừa đọc từ kho.

        `trim_window` chạy lại ở đây chứ không chỉ lúc ghi, vì từ C-027 danh
        sách này có thể đến từ một tiến trình khác: bản ghi của lần chạy trước,
        hoặc một lần ghi dở. Không cắt lại thì lượt ĐẦU TIÊN sau khi khởi động
        lại đã có thể mở đầu bằng một `functionResponse` mồ côi — đúng lỗi 400
        của C-026, nhưng ở dạng khó lần hơn nhiều vì nó không cần nói tới 12
        lượt mới hiện ra.

        `trim_window` chỉ đảm bảo mép TRÁI hợp lệ. Nếu kho trả về thứ méo ở
        giữa (file bị sửa tay, bản ghi của phiên bản cũ) thì thà bắt đầu lại từ
        trống — đúng chính sách "kho hỏng thì coi như rỗng" của cả hai tầng.
        """
        try:
            stored = self.turn_store.read(self.session_id)
        except Exception:
            return []
        window = trim_window(stored)
        return window if is_well_formed(window) else []

    def append_turn(self, message: AgentMessage) -> None:
        window = trim_window([*self.turns(), message])
        try:
            self.turn_store.write(self.session_id, window)
        except Exception:
            # Ghi hỏng thì lượt này mất ngữ cảnh, nhưng agent vẫn trả lời được.
            pass

    def clear_turns(self) -> None:
        try:
            self.turn_store.clear(self.session_id)
        except Exception:
            pass

    def purge(self) -> None:
        """Dọn sạch cả hai tầng khi phiên kết thúc.

        Hết bàn thì luật nhà lẫn hội thoại đều hết tác dụng. Không dọn thì kho
        phình mãi bằng rác của những phiên không ai mở lại nữa.
        """
        self.clear_turns()
        try:
            self.store.clear(self.session_id)
        except Exception:
            pass


def create_memory(
    session_id: str = FALLBACK_SESSION,
    store: FactStore | None = None,
    turn_store: TurnStore | None = None,
) -> Memory:
    return Memory(session_id, store, turn_store)
