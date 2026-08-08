"""Kiểu dữ liệu cốt lõi — xem docs/product/scoring.md.

Bất biến: điểm tổng KHÔNG lưu trực tiếp. Scoreboard luôn tính lại từ các Round
có status 'recorded'. Không có đường nào ghi thẳng vào total.

Dùng Pydantic vì hai lẽ: FastAPI sinh OpenAPI từ đây (ADR 17 — client lấy kiểu
từ đó, khỏi khai tay hai lần), và dữ liệu đọc lên từ file JSON được kiểm hình
dạng ngay tại cửa thay vì nổ ở giữa phần tính điểm.

Tên field giữ nguyên camelCase của bản TypeScript: client đang đọc thẳng JSON
này, đổi sang snake_case là bẻ hợp đồng ở stage 05 mà không được gì.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SessionStatus = Literal["active", "ended"]
PlayerStatus = Literal["active", "removed"]
RoundStatus = Literal["recorded", "voided"]
RoundSource = Literal["voice", "manual"]
RoundEventKind = Literal["created", "updated", "voided", "restored"]

MIN_PLAYERS = 4
MAX_PLAYERS = 5


class Base(BaseModel):
    """Bỏ field None khi xuất JSON, cho khớp `field?:` của TypeScript.

    `json_schema_serialization_defaults_required`: field có giá trị mặc định
    (`entries`, `players`, `rows`…) LUÔN có mặt trong response, nên phải khai là
    bắt buộc ở schema. Không có cờ này thì kiểu sinh ra cho client đánh dấu
    chúng là optional, và mọi chỗ đọc phải `?? []` một cách vô nghĩa — tệ hơn:
    kiểu nói dối về hình dạng dữ liệu thật.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )

    def dump(self) -> dict:
        return self.model_dump(mode="json", exclude_none=True, by_alias=True)


class ScoringConfig(Base):
    """MVP chỉ hỗ trợ 'direct' — xem decision 0002."""

    mode: Literal["direct"] = "direct"
    startingScore: int = 0
    zeroSum: bool = True
    allowNegative: bool = True


DEFAULT_SCORING_CONFIG = ScoringConfig()


class Player(Base):
    id: str
    sessionId: str
    name: str
    seatNo: int | None = None
    status: PlayerStatus = "active"


class ScoreEntry(Base):
    id: str
    roundId: str
    playerId: str
    delta: int


class RoundEventEntry(Base):
    playerId: str
    delta: int


class RoundEvent(Base):
    """Nhật ký thay đổi của một ván — bất biến, chỉ thêm không sửa (ADR 8).

    Cho sửa trực tiếp từng ô mà không truy được ai sửa gì lúc nào thì mất luôn
    khả năng giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Log là
    điều kiện để mở tính năng sửa, không phải tính năng phụ.
    """

    id: str
    kind: RoundEventKind
    at: str
    source: RoundSource
    #: Vắng khi kind = "created".
    before: list[RoundEventEntry] | None = None
    #: Vắng khi kind = "voided".
    after: list[RoundEventEntry] | None = None
    #: Mục này sinh ra do bấm Hoàn tác / Làm lại, không phải thao tác mới.
    #:
    #: Nhật ký bất biến nên undo KHÔNG xoá mục cũ — nó ghi thêm một mục nữa để
    #: vẫn truy được "ai bấm hoàn tác lúc nào". Nhưng những mục này KHÔNG tính
    #: vào chuỗi thao tác mà con trỏ undo đi qua; xem `undoDepth` ở Session.
    isUndo: bool | None = None
    isRedo: bool | None = None


class Round(Base):
    id: str
    sessionId: str
    sequenceNo: int
    status: RoundStatus = "recorded"
    createdAt: str
    source: RoundSource = "manual"
    entries: list[ScoreEntry] = Field(default_factory=list)
    #: Dữ liệu cũ không có field này — mọi chỗ đọc phải chịu được thiếu.
    events: list[RoundEvent] | None = None
    #: Chống ghi trùng khi STT/mạng lặp yêu cầu.
    clientRequestId: str | None = None


class Session(Base):
    id: str
    name: str | None = None
    status: SessionStatus = "active"
    scoringConfig: ScoringConfig = Field(default_factory=ScoringConfig)
    players: list[Player] = Field(default_factory=list)
    rounds: list[Round] = Field(default_factory=list)
    createdAt: str
    endedAt: str | None = None
    #: Người đang cầm máy — để hiểu "tôi được bao nhiêu".
    mePlayerId: str | None = None
    #: Xác nhận trước khi ghi. Mặc định bật; tắt được trong cài đặt.
    confirmBeforeCommit: bool = True
    #: Đang lùi bao nhiêu bước so với thao tác mới nhất.
    #:
    #: 0 = đang ở hiện tại. Bấm Hoàn tác thì tăng, Làm lại thì giảm. Một thao
    #: tác MỚI đưa về 0 — đúng như mọi trình soạn thảo: làm việc mới thì mất
    #: nhánh redo. Không nằm trong nhật ký vì nhật ký bất biến; đây là con trỏ,
    #: không phải lịch sử.
    undoDepth: int | None = None


class ScoreboardRow(Base):
    playerId: str
    name: str
    total: int
    rank: int


class Scoreboard(Base):
    rows: list[ScoreboardRow] = Field(default_factory=list)
    roundsPlayed: int = 0


class DraftEntry(Base):
    """Một ô điểm đang gõ dở, trước khi thành `ScoreEntry` thật."""

    playerId: str
    delta: int
