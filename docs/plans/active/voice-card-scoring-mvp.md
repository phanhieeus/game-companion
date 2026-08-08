# Execution Plan: Voice Card Scoring MVP

Date: 2026-08-08

## Status

Active

## Outcome

Một web app chạy trên trình duyệt điện thoại: tạo phiên 4–5 người, nhấn nút nói
một câu tiếng Việt sau mỗi ván, agent đọc lại xác nhận, ghi điểm đúng, và trả lời
được câu hỏi "ai đang dẫn". Bảng điểm luôn = tổng các ván hợp lệ.

## Context

- [`docs/product/overview.md`](../../product/overview.md) và các doc cùng thư mục.
- [`decision 0001`](../../decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md)
  — giữ nguyên tên/schema tool.
- [`decision 0002`](../../decisions/0002-mvp-stack-web-app-free-providers.md)
  — stack và nhà cung cấp miễn phí.

## Scope

In scope:

- Chế độ `direct` + `zero_sum` (chỉ một chế độ).
- Xác nhận trước khi ghi, có toggle tắt trong cài đặt.
- Tool layer đúng tên/schema như `docs/product/tools.md`.
- Web Speech API cho STT/TTS; Gemini Flash-Lite qua proxy cho intent.
- Lưu localStorage để mở lại app vẫn còn phiên.

Out of scope:

- Chế độ `rank`, plugin platform, tài khoản/đồng bộ, thống kê nâng cao.

## Approach

Xây từ trong ra ngoài, để phần đúng-đắn được test trước phần khó đo:

1. `domain/` — types + scoring engine thuần (không I/O), validate zero-sum.
2. `repository/` — interface + localStorage, tách khỏi logic tính điểm.
3. `tools/` — 11 hàm theo hợp đồng, trả `Result`, có idempotency.
4. Test vitest cho domain + tools (bất biến: scoreboard = tổng ván recorded).
5. `nlu/` + proxy server — Gemini function calling ánh xạ vào chính các tool đó.
6. `voice/` — wrapper Web Speech API (push-to-talk, vi-VN).
7. `ui/` — bảng điểm responsive + nút Voice + hộp xác nhận.

## Risks And Recovery

- **Rủi ro chính: STT tiếng Việt không đủ chính xác.** Đây là giả định MVP cần
  đo. Giảm thiểu: zero-sum validate bắt sai tổng; xác nhận trước khi ghi. Nếu
  không đạt → xem lại lựa chọn STT (decision 0002 follow-up).
- Quota Gemini 1000 req/ngày: nếu hết, chờ sang ngày hoặc thêm key thứ hai.
- Safari/iOS hỗ trợ Web Speech API kém: kiểm tra sớm, trước khi xây nhiều UI.
- Rollback: mọi bước là commit riêng; domain và tools không phụ thuộc voice nên
  có thể giữ lại kể cả khi đổi hoàn toàn tầng speech.

## Progress

- [x] Scaffold Vite + React + TS
- [x] domain: types, scoring, validate
- [x] repository: localStorage
- [x] tools: hợp đồng 11 hàm
- [x] test domain + tools (41 test pass)
- [x] proxy server + Gemini NLU
- [x] voice: STT/TTS wrapper
- [x] UI: scoreboard + voice + confirm
- [x] E2E Playwright với SpeechRecognition giả (11 test)
- [x] Kiểm tiếng Việt trên Gemini thật (`check:nlu`, 10/10)
- [ ] **Chạy thật một phiên với micro, đo độ chính xác STT** ← còn lại

Đã verify bằng máy:

- `npm test` — 44 pass (domain, repository, tools, phrases)
- `npm run test:e2e` — 11 pass, đi hết luồng từ chữ → intent → xác nhận → ghi
  điểm → bảng điểm, gồm cả từ chối xác nhận, chặn tổng ≠ 0, undo, và mở lại app
- `npm run check:nlu` — 10/10 câu tiếng Việt ra đúng intent trên
  `gemini-3.1-flash-lite`
- `npm run build` sạch

Chưa verify: **chỉ còn đúng phần STT** (giọng → chữ). Web Speech API trong
Chromium không chạy nhận dạng thật nên phải thử tay trên Chrome thật.

Bug đã tìm ra và sửa trong lúc test:

- Repository trả về tham chiếu dùng chung; tool layer sửa tại chỗ nên React
  không thấy state đổi → **ghi điểm xong bảng điểm đứng im**. Sửa thành value
  store (clone vào/ra), có test chặn tái phát.
- `readConfirmation` quét cả câu nên "Hùng trừ một thôi" bị hiểu là từ chối
  ("thôi" = trợ từ "chỉ"), nuốt mất câu sửa. Sửa thành chỉ xét từ đầu câu.
- 429 bị báo nhầm luôn là "hết quota hôm nay" kể cả khi chỉ vượt 15 lượt/phút.
- `gemini-2.5-flash-lite` thực tế chỉ 20 lượt/ngày, không phải 1000 như bài viết
  trên web — xem decision 0002.

## Decisions

- 2026-08-08: Chốt câu hỏi mở 1–3 (direct only, zero-sum, confirm mặc định bật
  cho tắt được) — xem decision 0002.
- 2026-08-08: Lưu trữ = localStorage (câu 4). Ngôn ngữ = chỉ tiếng Việt (câu 5).
  STT/TTS = Web Speech API on-device/browser (câu 6).

## Validation

- Focused proof: vitest trên `domain/` và `tools/` — bất biến scoreboard, validate
  zero-sum, idempotency của `record_round`.
- Integration proof: chạy app, nói một câu theo ví dụ D1 trong
  [`conversation.md`](../../product/conversation.md), xác nhận, kiểm tra bảng điểm.
- Repository-required checks: `npm test`, `npm run build`.

## Result

Chưa hoàn thành.
