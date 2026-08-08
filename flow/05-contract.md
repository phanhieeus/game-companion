# Stage 05 — Interface Contract (the seam)

> **Thích ứng theo hình dạng dự án** (template cho phép): app này không có API
> HTTP giữa core và UI. Seam thật là **tool layer trong tiến trình**
> (`src/tools/index.ts`) — hợp đồng ổn định theo
> [decision 0001](../docs/decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md),
> cộng với props của các component mới. Cột "Auth" thay bằng "Ghi/Đọc" vì không
> có auth (ADR quyết định 2). Endpoint HTTP duy nhất chỉ ghi lại để đối chiếu.
>
> **Sửa 2026-08-08 (C-009):** `/api/interpret` (single-shot: một câu → một intent)
> bị thay bằng `/api/agent` (một lượt trong vòng ReAct nhiều bước). Không giữ song
> song: hai đường "hiểu" mà chỉ một đường sống chính là thứ drift file này tồn tại
> để chặn. `src/nlu/` và `scripts/check-nlu.mjs` xoá theo.

Written BEFORE any code. Cards build TO this table.
Lý do file này tồn tại: producer/consumer drift — core trả một shape, UI giả định
shape khác, cả hai đều "xanh".

## Gate — check ALL before `/flow next`
- [x] Every PRD feature maps to at least one interface below
- [x] Every interface has request AND response shapes written
- [x] Ghi/Đọc column filled for every interface
- [x] No FILL placeholders remain in this file

## Interfaces — tool layer (đã có, KHÔNG đổi chữ ký)

| Kind | Name | Ghi/Đọc | Request shape | Response shape |
|---|---|---|---|---|
| tool | `record_round` | Ghi | `{ session_id, entries: {playerId, delta}[], client_request_id?, source?: "voice"\|"manual" }` | `Result<{ round_id, scoreboard }>` |
| tool | `undo_round` | Ghi | `{ session_id, round_id? }` | `Result<{ voided_round_id, scoreboard }>` |
| tool | `get_history` | Đọc | `{ session_id, limit? }` | `Result<{ rounds: Round[] }>` |
| tool | `get_scoreboard` | Đọc | `{ session_id }` | `Result<Scoreboard>` |
| tool | `get_round_events` | Đọc | `{ session_id, round_id }` | `Result<{ events: RoundEvent[] }>` |
| http | `POST /api/agent` | Đọc | `{ messages: AgentMessage[], tools: Declaration[], context }` | `{ call: {name, args} }` \| `{ text }` \| `{ error, retryable }` |

**Nhập tay dùng lại `record_round` với `source: "manual"`** — không thêm tool mới
(ADR quyết định 4). `source` đã có sẵn trong `Round` từ đầu.

## Interfaces — HTTP API (thêm 2026-08-08, C-011…C-013)

> **Sửa lớn (ADR 13):** seam thật chuyển từ tool layer trong tiến trình sang HTTP.
> Bảng tool layer bên dưới KHÔNG đổi chữ ký — nó chỉ chuyển chỗ ở, từ trình duyệt
> sang server. Client không còn gọi tool trực tiếp; nó gọi các endpoint này.

| Kind | Name | Ghi/Đọc | Request shape | Response shape |
|---|---|---|---|---|
| http | `POST /api/sessions` | Ghi | header `X-Device-Id?` + `{ players: {name}[], me_player_name? }` | `{ session: Session }` |
| http | `GET /api/sessions/:id` | Đọc | — | `{ session: Session }` |
| http | `GET /api/sessions/active` | Đọc | header `X-Device-Id?` | `{ session: Session \| null }` |
| http | `POST /api/sessions/:id/rounds` | Ghi | `{ entries: {playerId, delta}[], client_request_id? }` | `{ session, scoreboard }` |
| http | `PATCH /api/sessions/:id/rounds/:roundId` | Ghi | `{ entries: {playerId, delta}[] }` | `{ session, scoreboard }` |
| http | `DELETE /api/sessions/:id/rounds/:roundId` | Ghi | — | `{ session, scoreboard }` |
| http | `POST /api/sessions/:id/undo` \| `/redo` | Ghi | — | `{ session, label }` |
| http | `GET /api/sessions/:id/rounds/:roundId/events` | Đọc | — | `{ events: RoundEvent[] }` |
| http | `POST /api/sessions/:id/players` | Ghi | `{ name }` | `{ session }` |
| http | `DELETE /api/sessions/:id/players/:playerId` | Ghi | — | `{ session }` |
| http | `PATCH /api/sessions/:id/settings` | Ghi | `{ confirm_before_commit }` | `{ session }` |
| http | `POST /api/sessions/:id/end` | Ghi | — | `{ session }` |
| http | `POST /api/sessions/:id/agent` | Ghi | `{ text }` | `{ outcome: AgentOutcome, session, steps }` |
| http | `POST /api/sessions/:id/agent/confirm` | Ghi | `{ accepted: boolean }` | `{ outcome, session, steps }` |

Lỗi dùng chung một dạng: `{ error: { code, message }, retryable }` — `code` lấy
nguyên từ tool layer (`ROUND_NOT_ZERO_SUM`…) nên UI phân biệt được lỗi luật chơi
với lỗi hạ tầng.

**`X-Device-Id` — thiết bị, KHÔNG phải danh tính** (thêm 2026-08-08, C-019; ADR 15).
Client sinh một UUID, lưu localStorage, gửi kèm MỌI request. `POST /api/sessions`
ghi nó vào `Session.deviceId`; `GET /api/sessions/active` chỉ trả phiên của đúng
thiết bị đó. Thiếu header → `{ session: null }` (thiết bị lạ không được thấy ván
bài của người khác), nhưng vẫn tạo phiên mới được. Phiên chỉ rời khỏi `active`
khi `POST /api/sessions/:id/end` — đóng tab hay hết pin thì mở lại vẫn đúng ván cũ.

**Chốt HITL nằm ở SERVER**: `/agent` trả `outcome.type === "confirm"` và server
giữ lời gọi đang chờ của phiên đó cho tới khi `/agent/confirm` tới. Client không
bao giờ cầm được quyền chạy tool.

## Interfaces — mini-agent (chạy trên server sau ADR 13)

| Kind | Name | Ghi/Đọc | Request shape | Response shape |
|---|---|---|---|---|
| type | `AgentTool` | — | `{ name, description, parameters, needsConfirm?, describe?, propose?, run }` | — |
| fn | `runAgent` | Ghi | `(userText: string, ctx: ToolContext)` | `Promise<{ outcome: AgentOutcome, changed, steps }>` |
| fn | `resumeAgent` | Ghi | `(call: ToolCall, accepted: boolean, ctx)` | `Promise<StepResult>` |
| type | `AgentOutcome` | — | — | `{final,text}` \| `{confirm,prompt,rows,call}` \| `{clarify,question}` \| `{error,message,retryable}` |
| store | `MemoryStore` | Ghi+Đọc | — | `{ facts, remember, forget, turns, appendTurn, clearTurns }` |

`needsConfirm` và `propose` khai ở TOOL, không do model quyết (ADR 12) — model
chỉ đề xuất, code quyết định hỏi gì và hiện con số nào.

## Interfaces — component props (mới trong vòng này)

| Kind | Name | Ghi/Đọc | Props in | Renders / calls out |
|---|---|---|---|---|
| component | `RoundsTable` | Đọc | `{ session: Session, rounds: Round[], order: RoundOrder, onToggleOrder: () => void, onUndo: (roundId: string) => void }` | Bảng `n+1` cột; gọi `onUndo` khi bấm hủy một ván |
| component | `EditableRow` | Ghi | `{ players, draft: Record<string,string>, onChange, onSave, onCancel, error }` | Hàng ô số sửa được tại chỗ; `onSave` chỉ bật khi tổng = 0 |
| component | `RoundHistory` | Đọc | `{ events: RoundEvent[], players, onClose }` | Popup chi tiết thêm/sửa/xóa của một ván |
| component | `Scoreboard` (gọn lại) | Đọc | `{ scoreboard: Scoreboard, mePlayerId?: string, compact?: boolean }` | Một hàng mỗi người; `compact` giảm chiều cao |
| hook | `useRoundOrder` | Ghi+Đọc | — | `[order, toggle]`, lưu vào `localStorage` |

## Shared shapes (objects used by multiple interfaces)

```ts
// Đã có — src/domain/types.ts, KHÔNG đổi
Round      { id, sessionId, sequenceNo, status: "recorded"|"voided",
             createdAt, source: "voice"|"manual", entries: ScoreEntry[],
             clientRequestId? }
ScoreEntry { id, roundId, playerId, delta }
Scoreboard { rows: { playerId, name, total, rank }[], roundsPlayed }
DraftEntry { playerId, delta }
Result<T>  { ok: true, data: T, error: null } | { ok: false, data: null, error: {code, message} }

// Mới 2026-08-08 — audit log (ADR quyết định 8)
type RoundEventKind = "created" | "updated" | "voided" | "restored"
RoundEvent {
  id, kind: RoundEventKind, at: ISO string,
  source: "voice" | "manual",
  before?: { playerId, delta }[],   // vắng khi kind = "created"
  after?:  { playerId, delta }[],   // vắng khi kind = "voided"
}
// Round nhận thêm: events: RoundEvent[]
// Dữ liệu localStorage CŨ không có field này — đọc phải chịu được `undefined`.

// Mới trong vòng này — src/ui/roundOrder.ts
type RoundOrder = "newest-last" | "newest-first"   // mặc định "newest-last"
const ROUND_ORDER_KEY = "game-companion:round-order:v1"

// Dẫn xuất cho bảng — KHÔNG lưu, tính từ rounds mỗi lần render
type TableCell = number | null      // null = người này không có điểm trong ván đó
type TableRow  = { round: Round; cells: TableCell[] }   // cells cùng thứ tự với players
```

**Quy ước ô trống:** `null` hiện là `·`, không phải `0`. Ván zero-sum thì ai cũng
có delta, nhưng nếu sau này bỏ zero-sum thì `0` (có ghi, bằng 0) khác hẳn `null`
(không tham gia). Phân biệt từ đầu rẻ hơn sửa sau.

## Feature → interface map

| PRD feature | Interface phục vụ nó |
|---|---|
| Bảng nhiều cột theo ván | `get_history` → `RoundsTable` |
| Số ván cột đầu, delta từng người | `Round.sequenceNo` + `TableRow.cells` |
| Nút đổi thứ tự, nhớ lựa chọn | `useRoundOrder` + `RoundsTable.order` |
| Nút về đầu trang | thuần DOM (`window.scrollTo`), không cần interface |
| Bảng tổng gọn lại | `Scoreboard` prop `compact` |
| Hủy một ván từ bảng | `RoundsTable.onUndo` → `undo_round` |
| Nhập điểm bằng tay | `ManualEntry.onSubmit` → `record_round` (`source: "manual"`) |
