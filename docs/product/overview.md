# Voice Card Scoring — Overview

Nguồn intent: [`SPEC.md`](../../SPEC.md) v1.1 (Draft để review).

MVP đầu tiên của Game Companion: **điều khiển bằng giọng nói** để **ghi điểm** và
**tra cứu điểm** cho một game đánh bài 4–5 người, có cấu hình cách tính điểm.
Voice là giao diện chính.

## Mục tiêu

Một nhóm 4–5 người đang chơi bài. Sau mỗi ván, một người nói vào điện thoại để ghi
điểm; bất kỳ lúc nào cũng hỏi bằng giọng nói để biết ai đang dẫn / điểm của mình.
Cách tính điểm cấu hình được để hợp nhiều luật nhà.

Điểm mấu chốt là **hội thoại đáng tin**: nghe nhầm điểm là mất vui, nên agent phải
đọc lại để xác nhận trước khi ghi, và sửa nhanh khi nói nhầm.

## Tiêu chí thành công

- Tạo phiên 4–5 người và đặt cách tính điểm (bằng giọng nói hoặc thao tác nhanh).
- Nói một câu tự nhiên sau mỗi ván → agent hiểu, xác nhận, ghi đúng.
- Hỏi điểm/bảng xếp hạng bằng giọng nói → nghe trả lời tức thì.
- Nói nhầm → hủy hoặc sửa ván bằng giọng nói.
- Số liệu luôn nhất quán (bảng điểm = tổng các ván hợp lệ).

## Phạm vi

### Trong phạm vi MVP

- **Voice**: push-to-talk (nhấn nút để nói, không nghe liên tục), STT, TTS.
- **Ghi điểm bằng giọng nói**: nhập, xác nhận, sửa, hủy ván.
- **Tra cứu bằng giọng nói**: bảng điểm, điểm một người, lịch sử ván gần đây.
- **Cấu hình điểm**: chọn cách tính, sửa được.
- Quản lý phiên & người chơi (tạo phiên, thêm/xóa người).

### Ngoài phạm vi (đợt sau)

- Plugin platform: Capability Registry, LLM Planner tách tầng, Tool Dispatcher
  tổng quát, Tool Registry động, Event Bus, Plugin Loader.
- Đa game / nhiều luật bài trong một build.
- Thống kê nâng cao, thành tích, thông báo đẩy.
- Tài khoản, đăng nhập, đồng bộ đám mây, nhiều thiết bị.
- Nghe liên tục (always-on) / wake word.

## Khái niệm cốt lõi

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

## Nguyên tắc UX

- **Nhấn để nói** (push-to-talk), không nghe lén.
- **Luôn có bảng điểm nhìn thấy được** trên màn hình song song với giọng nói —
  giọng nói để nhập/hỏi nhanh, mắt vẫn kiểm tra được.
- **Xác nhận trước khi ghi** mọi thay đổi điểm. Tra cứu thì trả lời thẳng.
- **Câu trả lời ngắn, nghe được** (đọc số to, rõ, không lê thê).

## Luồng end-to-end

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

## Tài liệu liên quan

- [`scoring.md`](scoring.md) — cấu hình điểm, data model, cách tính scoreboard.
- [`voice-pipeline.md`](voice-pipeline.md) — state machine của một lượt nói.
- [`conversation.md`](conversation.md) — intent, trích tham số, xác nhận/làm rõ/sửa lỗi.
- [`tools.md`](tools.md) — hợp đồng các hàm ghi/tra cứu và mã lỗi.
- [`open-questions.md`](open-questions.md) — **câu hỏi chưa chốt, chặn việc build**.
- [`../decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md`](../decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md)
  — vì sao tên/schema hàm phải giữ nguyên.
