# Voice Card Scoring — MVP Specification (v1.1)

> **Đây là bản spec gốc, đóng băng để làm provenance.** Nó ghi lại intent tại thời
> điểm nhận, **không phải** operating manual.
>
> Tài liệu sống mà agent và người build nên đọc nằm ở [`docs/product/`](docs/product/).
> Khi behavior thay đổi, cập nhật `docs/product/`, **không** sửa file này.
> Chỉ thay file này khi nhận một bản spec mới từ đầu (v1.2, v2…).

**Trạng thái:** Draft để review · **Ngôn ngữ:** Tiếng Việt (thuật ngữ kỹ thuật giữ tiếng Anh)

---

## Mục lục

1. [Mục tiêu MVP](#1-mục-tiêu-mvp)
2. [Phạm vi (In / Out)](#2-phạm-vi-in--out)
3. [Trải nghiệm chính (voice-first)](#3-trải-nghiệm-chính-voice-first)
4. [Khái niệm cốt lõi](#4-khái-niệm-cốt-lõi)
5. [Cấu hình điểm (Scoring Config)](#5-cấu-hình-điểm-scoring-config)
6. [Data Model](#6-data-model)
7. [Voice Session & pipeline](#7-voice-session--pipeline)
8. [Intent & hiểu câu nói](#8-intent--hiểu-câu-nói)
9. [Hội thoại: xác nhận, làm rõ, sửa lỗi](#9-hội-thoại-xác-nhận-làm-rõ-sửa-lỗi)
10. [Tool layer (các hàm ghi/tra cứu)](#10-tool-layer-các-hàm-ghitra-cứu)
11. [Ví dụ hội thoại](#11-ví-dụ-hội-thoại)
12. [Luồng end-to-end](#12-luồng-end-to-end)
13. [Vị trí trong system design tổng thể](#13-vị-trí-trong-system-design-tổng-thể)
14. [Ngoài phạm vi MVP](#14-ngoài-phạm-vi-mvp)
15. [Câu hỏi mở cần chốt](#15-câu-hỏi-mở-cần-chốt)

---

## 1. Mục tiêu MVP

Một nhóm 4–5 người đang chơi bài. Sau mỗi ván, **một người nói vào điện thoại** để
ghi điểm; bất kỳ lúc nào cũng **hỏi bằng giọng nói** để biết ai đang dẫn / điểm của
mình. Cách tính điểm **cấu hình được** để hợp nhiều luật nhà.

Điểm mấu chốt của MVP này là **hội thoại đáng tin**: vì nghe nhầm điểm là mất vui,
agent phải **đọc lại để xác nhận trước khi ghi**, và **sửa nhanh** khi nói nhầm.

Tiêu chí thành công:

- Tạo phiên 4–5 người và đặt cách tính điểm (bằng giọng nói hoặc thao tác nhanh).
- Nói một câu tự nhiên sau mỗi ván → agent hiểu, xác nhận, ghi đúng.
- Hỏi điểm/bảng xếp hạng bằng giọng nói → nghe trả lời tức thì.
- Nói nhầm → hủy hoặc sửa ván bằng giọng nói.
- Số liệu luôn nhất quán (bảng điểm = tổng các ván hợp lệ).

---

## 2. Phạm vi (In / Out)

### ✅ Trong phạm vi MVP

- **Voice**: push-to-talk (nhấn nút để nói, không nghe liên tục), STT, TTS.
- **Ghi điểm bằng giọng nói**: nhập, xác nhận, sửa, hủy ván.
- **Tra cứu bằng giọng nói**: bảng điểm, điểm một người, lịch sử ván gần đây.
- **Cấu hình điểm**: chọn cách tính, sửa được.
- Quản lý phiên & người chơi (tạo phiên, thêm/xóa người).

### ❌ Ngoài phạm vi (đợt sau)

- Plugin platform: Capability Registry, LLM Planner tách tầng, Tool Dispatcher
  tổng quát, Tool Registry động, Event Bus, Plugin Loader.
- Đa game / nhiều luật bài trong một build.
- Thống kê nâng cao, thành tích, thông báo đẩy.
- Tài khoản, đăng nhập, đồng bộ đám mây, nhiều thiết bị.
- Nghe liên tục (always-on) / wake word.

> Ghi chú thiết kế: các hàm ghi/tra cứu ở [mục 10](#10-tool-layer-các-hàm-ghitra-cứu)
> được đặt tên & schema đúng như "tool" trong kiến trúc đầy đủ, để sau này bọc
> plugin platform lên mà không phải viết lại (xem [mục 13](#13-vị-trí-trong-system-design-tổng-thể)).

---

## 3. Trải nghiệm chính (voice-first)

```text
[Màn hình chính: bảng điểm live + 1 nút Voice lớn]

Người dùng nhấn nút  →  nói  →  nhả tay
        ↓
Agent hiểu + đọc lại để xác nhận (nếu là ghi điểm)
        ↓
Người dùng "ừ" / "đúng" → ghi → bảng điểm cập nhật + agent đọc kết quả
```

Nguyên tắc UX:
- **Nhấn để nói** (push-to-talk), không nghe lén.
- **Luôn có bảng điểm nhìn thấy được** trên màn hình song song với giọng nói —
  giọng nói để nhập/hỏi nhanh, mắt vẫn kiểm tra được.
- **Xác nhận trước khi ghi** mọi thay đổi điểm. Tra cứu thì trả lời thẳng.
- **Câu trả lời ngắn, nghe được** (đọc số to, rõ, không lê thê).

---

## 4. Khái niệm cốt lõi

| Khái niệm | Ý nghĩa |
|---|---|
| **Session** | Một phiên chơi từ lúc bắt đầu đến khi kết thúc |
| **Player** | Người chơi trong phiên (4–5 người) |
| **Round** | Một ván; **nguồn sự thật** của điểm số |
| **ScoreEntry** | Điểm (delta) của một người trong một ván |
| **ScoringConfig** | Bộ cấu hình cách tính điểm |
| **Scoreboard** | Bảng điểm, **tính ra** từ các ván hợp lệ (không lưu tay) |
| **Utterance** | Một lượt nói của người dùng (audio → text) |
| **Intent** | Ý định suy ra từ câu nói (ghi điểm / hỏi điểm / hủy…) |

**Nguyên tắc mấu chốt** (giữ từ bản trước): điểm tổng **không lưu trực tiếp** mà
cộng dồn từ các `Round` hợp lệ; hủy/sửa ván = đánh dấu ván rồi tính lại — không
bao giờ sửa tay điểm tổng.

---

## 5. Cấu hình điểm (Scoring Config)

Hỗ trợ 2 chế độ cho mỗi phiên (phủ phần lớn luật bài Việt). Có thể đặt bằng giọng
nói lúc tạo phiên ("chơi tính điểm theo hạng, nhất 3 nhì 1...") hoặc chọn nhanh
trên màn hình.

### 5.1 Chế độ `direct` — nhập trực tiếp điểm ±
```yaml
mode: direct
starting_score: 0
zero_sum: true         # tổng điểm mỗi ván = 0 (điểm chuyển giữa người chơi)
allow_negative: true
```

### 5.2 Chế độ `rank` — nhập thứ hạng, quy ra điểm
```yaml
mode: rank
starting_score: 0
rank_points: [3, 1, -1, -3]   # điểm cho hạng 1..N; độ dài = số người
tie_policy: split             # split | same
```

Cấu hình đặt khi tạo phiên và **sửa được giữa phiên**; ván đã ghi **không hồi tố**
(cần chốt — [mục 15](#15-câu-hỏi-mở-cần-chốt)).

---

## 6. Data Model

```text
Session 1──1 ScoringConfig
Session 1──* Player      (4–5)
Session 1──* Round
Round   1──* ScoreEntry
```

| Entity | Field chính |
|---|---|
| **Session** | id, name?, status(`active`/`ended`), scoring_config, created_at, ended_at? |
| **Player** | id, session_id, name, seat_no?, status(`active`/`removed`) |
| **Round** | id, session_id, sequence_no, status(`recorded`/`voided`), created_at, source(`voice`/`manual`) |
| **ScoreEntry** | id, round_id, player_id, rank?, delta |

**Scoreboard (derived, không lưu):**
```text
total(player) = starting_score
              + Σ delta của ScoreEntry thuộc Round status = 'recorded'
```
```yaml
Scoreboard:
  rows: [{ player_id, name, total, rank }]   # rank 1 = cao nhất, cho đồng hạng
  rounds_played: integer
```

> `source` thêm mới ở bản này để biết ván ghi bằng voice hay tay (hữu ích khi
> debug nhận dạng giọng nói).

---

## 7. Voice Session & pipeline

Không nghe liên tục. State machine mỗi lượt:

```text
Idle
  │ (nhấn nút Voice)
  ▼
Listening ──► Understanding ──► [Clarifying] ──► [Confirming] ──► Executing ──► Responding ──► Idle
   STT           NLU/LLM         hỏi lại nếu       đọc lại &        gọi hàm         TTS
                                 thiếu tin        chờ "ừ"          ghi/tra cứu
```

| Trạng thái | Việc làm |
|---|---|
| **Idle** | Chờ, không thu âm. Màn hình hiện bảng điểm. |
| **Listening** | Thu âm khi giữ nút; nhả tay → dừng. STT ra text. |
| **Understanding** | LLM suy Intent + trích tham số (ai, bao nhiêu, hạng…). |
| **Clarifying** | Nếu thiếu/mập mờ → hỏi lại 1 câu ngắn, quay lại Listening. |
| **Confirming** | Với hành động **ghi điểm** → đọc lại, chờ xác nhận. |
| **Executing** | Gọi hàm tương ứng (record/query/undo…). |
| **Responding** | Sinh câu trả lời tự nhiên + TTS, rồi về Idle. |

Lỗi ở bất kỳ đâu (STT trống, hàm trả lỗi) → về **Responding** với câu lỗi thân
thiện ("Mình chưa nghe rõ, nói lại giúp nhé"), rồi Idle. Không ghi gì khi lỗi.

---

## 8. Intent & hiểu câu nói

### 8.1 Các intent MVP hỗ trợ

| Intent | Ví dụ câu nói | Hàm gọi |
|---|---|---|
| `record_round` | "Nam ăn 3, ba người kia chung 1" | `record_round` |
| `query_scoreboard` | "Ai đang dẫn?", "Bảng điểm sao rồi?" | `get_scoreboard` |
| `query_player` | "Tôi được bao nhiêu?", "Hùng mấy điểm?" | `get_player_score` |
| `undo_round` | "Nhầm rồi, hủy ván vừa nãy" | `undo_round` |
| `correct_round` | "Sửa lại ván nãy, Hùng -1 thôi" | `update_round` |
| `add_player` | "Thêm Minh vào" | `add_player` |
| `history` | "Ván trước ai thắng?" | `get_history` |
| `end_session` | "Kết thúc, tính tổng đi" | `end_session` |

Ngoài danh sách → agent nói không hỗ trợ và gợi ý việc làm được.

### 8.2 Trích tham số (parameter extraction)

Từ text, LLM cần rút:
- **Người**: ánh xạ tên nói ra → `player_id` trong phiên. Tên lạ → Clarifying.
  Xử lý biến thể ("tôi/tao/mình" = người đang cầm máy nếu đã biết là ai).
- **Số điểm / dấu**: "ăn/thắng" = dương, "chung/thua/đền" = âm; đọc số tiếng Việt.
- **Thứ hạng** (chế độ rank): "nhất/nhì/ba/bét…" → rank.
- **Cụm gộp**: "ba người kia mỗi người chung 1" → suy ra 3 người còn lại, mỗi
  người −1.

### 8.3 Ràng buộc để hiểu đúng

- Ở chế độ `direct` + `zero_sum`: nếu tổng nói ra ≠ 0, **không tự bịa** cho đủ —
  hỏi lại hoặc đề xuất cách chia rồi xác nhận.
- Nếu chỉ nói người thắng: hỏi ai chung / chia thế nào (xem ví dụ D2).

---

## 9. Hội thoại: xác nhận, làm rõ, sửa lỗi

Đây là phần quyết định "dùng có sướng không". Ba cơ chế:

### 9.1 Xác nhận trước khi ghi (confirm-before-commit)
- **Mọi hành động thay đổi điểm** (`record`, `correct`, `undo`) → agent **đọc lại
  tóm tắt** rồi chờ "ừ/đúng/ok". Chỉ khi được đồng ý mới gọi hàm.
- **Tra cứu** → trả lời thẳng, không cần xác nhận.
- (Tùy chọn cấu hình: tắt xác nhận cho người chơi quen — mặc định **bật**.)

### 9.2 Làm rõ khi thiếu/mập mờ (clarify)
- Thiếu thông tin (ai chung? bao nhiêu?) → hỏi **đúng 1 câu ngắn**, không tra hỏi dồn.
- Tên lạ → hỏi "thêm người này hay bạn nói ai khác?".
- Mập mờ số → đọc lại con số nghe được để xác nhận.

### 9.3 Sửa lỗi nhanh (repair)
- Ngay khi xác nhận: người dùng nói khác đi → agent cập nhật bản nháp rồi xác nhận lại.
- Sau khi đã ghi: "hủy ván vừa rồi" → `undo`; "sửa ván nãy…" → `update`.
- Undo mặc định tác động **ván gần nhất**; muốn ván khác thì nói rõ ("ván thứ 3").

---

## 10. Tool layer (các hàm ghi/tra cứu)

MVP chưa cần Tool Registry động — LLM gọi trực tiếp các hàm dưới đây (qua cơ chế
tool/function-calling). Tên & schema đặt trùng "tool" tương lai để sau bọc plugin.

```text
create_session(name?, scoring_config, players[])         → { session_id, scoreboard }
add_player(session_id, name, seat_no?)                    → { player_id }
remove_player(session_id, player_id)                      → { ok }
update_scoring_config(session_id, scoring_config)         → { ok }

record_round(session_id, entries[], client_request_id?)   → { round_id, scoreboard }
      # direct: entries=[{player_id, delta}] · rank: entries=[{player_id, rank}]
update_round(session_id, round_id, entries[])             → { scoreboard }
undo_round(session_id, round_id?)                         → { voided_round_id, scoreboard }

get_scoreboard(session_id)                                → Scoreboard
get_player_score(session_id, player_id)                   → { name, total, rank }
get_history(session_id, limit?)                           → { rounds[] }
end_session(session_id)                                   → { scoreboard }
```

**Kết quả & lỗi:**
```yaml
Result: { ok: boolean, data: object|null, error: { code, message } }
```
| Mã lỗi | Khi nào |
|---|---|
| `SESSION_NOT_FOUND` | session không tồn tại |
| `PLAYER_NOT_IN_SESSION` | ghi cho người không thuộc phiên |
| `TOO_FEW_PLAYERS` / `TOO_MANY_PLAYERS` | ngoài 4–5 |
| `SUM_DELTA_NOT_ZERO` | direct + zero_sum, tổng ván ≠ 0 |
| `RANK_COUNT_MISMATCH` / `DUPLICATE_RANK` | lỗi nhập hạng |
| `NO_ROUND_TO_UNDO` | không còn ván để hủy |

`client_request_id` để không ghi trùng nếu STT/mạng lặp yêu cầu.

---

## 11. Ví dụ hội thoại

> Giả định phiên 4 người: **Nam, Hùng, Lan, Tú**. "Bạn" = người cầm máy.

**D1 — Ghi điểm (direct, zero-sum) có xác nhận**
```
Bạn:   (nhấn nút) "Ván này Nam ăn 3, ba người kia mỗi người chung 1."
Agent: "Nam +3, Hùng −1, Lan −1, Tú −1. Ghi ván này nhé?"
Bạn:   "Ừ."
Agent: "Xong ván 5. Nam đang dẫn với 12 điểm."
```

**D2 — Thiếu thông tin → làm rõ**
```
Bạn:   "Nam thắng 6."
Agent: "6 điểm này ai chung? Chia đều 3 người còn lại nhé?"
Bạn:   "Ừ chia đều."
Agent: "Nam +6, Hùng −2, Lan −2, Tú −2. Ghi nhé?"
Bạn:   "Ok."
Agent: "Đã ghi ván 6."
```

**D3 — Chế độ rank**
```
Bạn:   "Nam nhất, tôi nhì, Hùng ba, Lan bét."
Agent: "Nam +3, bạn +1, Hùng −1, Lan −3. Ghi nhé?"
Bạn:   "Đúng rồi."
Agent: "Ghi xong. Bạn đang hạng 2."
```

**D4 — Tra cứu bảng điểm (không cần xác nhận)**
```
Bạn:   "Ai đang dẫn?"
Agent: "Nam dẫn với 12 điểm. Kế đó Tú 4, bạn 1, Lan −3, Hùng −14."
```

**D5 — Hỏi điểm một người**
```
Bạn:   "Tôi được bao nhiêu rồi?"
Agent: "Bạn đang có 1 điểm, hạng 3."
```

**D6 — Hủy ván nhầm**
```
Bạn:   "Nhầm rồi, hủy ván vừa nãy."
Agent: "Đã hủy ván 6. Bảng điểm quay lại: Nam 9, Tú 3, bạn 1, Lan −1, Hùng −12."
```

**D7 — Tên lạ → làm rõ**
```
Bạn:   "Minh thắng 3."
Agent: "Mình chưa thấy Minh trong phiên. Thêm Minh vào chơi hay bạn nói người khác?"
Bạn:   "À Hùng, không phải Minh."
Agent: "Hùng +3, còn ai chung 3 điểm này?"
```

**D8 — Từ chối xác nhận rồi sửa**
```
Agent: "Nam +3, Hùng −3. Ghi nhé?"
Bạn:   "Không, Hùng −1 thôi, còn lại chia Lan với Tú."
Agent: "Nam +3, Hùng −1, Lan −1, Tú −1. Ghi nhé?"
Bạn:   "Ừ."
Agent: "Đã ghi."
```

---

## 12. Luồng end-to-end

```text
Nhấn nút Voice
   ↓  thu âm → STT
Text câu nói
   ↓
LLM: suy Intent + trích tham số   (ánh xạ tên → player_id, số, hạng)
   ↓
Đủ thông tin?  ── không ──►  hỏi lại 1 câu  ──►  (quay lại thu âm)
   ↓ có
Là hành động ghi điểm?  ── có ──►  đọc lại tóm tắt  ──►  chờ "ừ/không"
   ↓ (tra cứu thì bỏ qua xác nhận)                         │ không → sửa nháp
Gọi hàm (record/query/undo…)  ◄───────────────────────────┘ ừ
   ↓
Validate + (nếu ghi) cập nhật ván  → tính lại scoreboard
   ↓
LLM sinh câu trả lời ngắn → TTS
   ↓
Về Idle, bảng điểm trên màn hình cập nhật
```

---

## 13. Vị trí trong system design tổng thể

MVP này là **lát cắt dọc mỏng** của kiến trúc đầy đủ: một Voice/Conversation layer
tối giản + Business Logic ghi điểm của "Card Plugin", chưa có các tầng trừu tượng
tổng quát. Để sau ghép vào không phải đập đi:

- Các hàm [mục 10](#10-tool-layer-các-hàm-ghitra-cứu) = **tool** tương lai; giữ
  nguyên tên/schema, sau chỉ cần `register_tool()`.
- Vòng "Intent → chọn hàm → gọi → trả lời" hiện gọi trực tiếp; sau tách thành
  **LLM Planner + Tool Dispatcher + Tool Registry** mà không đổi hợp đồng hàm.
- `ScoringConfig` + luật → sau gói vào **Manifest + Rule Engine** của plugin.
- Tách **Repository** khỏi logic tính điểm ngay từ MVP.
- (Chưa dùng nhưng nên chừa chỗ) mọi ghi điểm đi qua một điểm duy nhất để sau gắn
  **Event Bus** — MVP chưa cần, chỉ cần đừng rải logic ghi khắp nơi.

---

## 14. Ngoài phạm vi MVP

- Plugin platform: Capability Registry, LLM Planner tách tầng, Tool Dispatcher/
  Registry tổng quát, Event Bus, Plugin Loader.
- Đa game / nhiều luật trong một build.
- Thống kê nâng cao, thành tích, thông báo.
- Tài khoản, đồng bộ đám mây, nhiều thiết bị.
- Nghe liên tục / wake word.

---

## 15. Câu hỏi mở cần chốt

Nhỏ nhưng ảnh hưởng trực tiếp khi build:

1. **Chế độ điểm cần cho lần đầu:** `direct`, `rank`, hay cả hai? Chỉ cần một thì
   tôi cắt bớt cho gọn.
2. **Zero-sum:** luật bài của bạn có nhà cái / phạt cố định không (ảnh hưởng
   `zero_sum`)?
3. **Xác nhận trước khi ghi:** bật mặc định (an toàn, chậm hơn một nhịp) hay cho
   tắt để nhập nhanh?
4. **Lưu trữ:** mở lại app vẫn còn phiên đang chơi (cần local DB) hay chỉ trong
   phiên chạy?
5. **Ngôn ngữ giọng nói:** chỉ tiếng Việt, hay cả tiếng Anh? Ảnh hưởng chọn
   STT/TTS.
6. **STT/TTS dùng gì:** on-device hay cloud (độ trễ, chi phí, offline)?
7. **"Tôi/mình" là ai:** có cần biết người cầm máy là player nào không (để hiểu
   "tôi được bao nhiêu")?

Chốt được câu 1–3 là đủ để bắt đầu; 4–7 quyết định hạ tầng, có thể bàn song song.

---

*Hết — Voice Card Scoring MVP Specification v1.1.*
