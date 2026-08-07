# 0002 Stack MVP: web app + nhà cung cấp miễn phí

Date: 2026-08-08

## Status

Accepted

## Context

Spec ([`SPEC.md`](../../SPEC.md)) nói "nói vào điện thoại" nhưng không chốt cách
build. MVP cần kiểm chứng một giả định rủi ro nhất: **nhận dạng tiếng Việt có đủ
chính xác để ghi điểm mà không gây bực mình không?** Chi phí phải bằng 0 ở giai
đoạn này.

Ba câu hỏi chặn build ([`open-questions.md`](../product/open-questions.md) 1–3) đã
được chốt cùng lúc.

## Decision

### Nền tảng

Web app (Vite + React + TypeScript), UI responsive cho mobile. Không build app
native. Lý do: vòng lặp phát triển nhanh nhất, mở bằng trình duyệt điện thoại là
test được ngay, không cần cài đặt.

### Speech: Web Speech API

STT và TTS dùng Web Speech API có sẵn trong trình duyệt. Chrome hỗ trợ `vi-VN`
cho cả hai chiều.

- Miễn phí, **không cần API key**.
- Đánh đổi: cần internet (server-backed, không chạy offline), thực tế chỉ chạy
  tốt trên Chrome/Edge, độ chính xác không có cam kết.
- Chấp nhận được vì đây chính là thứ MVP cần đo.

### LLM: Gemini 2.5 Flash-Lite

Intent parsing + trích tham số dùng Gemini 2.5 Flash-Lite qua free tier.

- 1000 requests/ngày, 15 RPM — đủ cho ~10 phiên/ngày khi test.
- Tiếng Việt tốt nhất trong các free tier khả dụng; có function calling khớp với
  tool layer ở [`tools.md`](../product/tools.md).
- Không chọn Gemini 2.5 Flash (chỉ 250 req/ngày — hết quota khi debug).
- Không chọn Groq (nhanh hơn nhiều nhưng tiếng Việt yếu hơn rõ rệt; nhận sai tên
  hoặc số là hỏng đúng thứ MVP cần chứng minh).

### Backend tối thiểu

Một proxy server nhỏ giữ Gemini API key. **Key không được nằm trong JavaScript
phía trình duyệt** — bất kỳ ai mở devtools cũng lấy được, và sẽ bị quét mất nếu
deploy. Proxy cũng là chỗ đặt system prompt và tool schema.

### Quyết định kèm theo (chốt câu hỏi 1–3)

- Chỉ chế độ `direct` (bỏ `rank` khỏi MVP).
- `zero_sum: true` — dùng làm lưới validate chống STT nghe nhầm số.
- Xác nhận trước khi ghi: **bật mặc định, cho tắt trong cài đặt**.

## Alternatives Considered

1. **React Native / Flutter.** Loại: vòng lặp phát triển chậm hơn, cần thiết lập
   build, chưa cần thiết để kiểm chứng giả định voice.
2. **Cloud STT trả phí (Google/Whisper).** Loại: có chi phí, và Web Speech API đủ
   để đo giả định. Nếu độ chính xác không đạt thì đây là bước nâng cấp tiếp theo.
3. **Rule-based parser (không LLM).** Loại: miễn phí và offline, nhưng gãy với câu
   nói tự nhiên ngoài mẫu — trái với mục tiêu cốt lõi của spec.
4. **Gọi Gemini thẳng từ trình duyệt.** Loại: lộ API key.

## Consequences

Positive:

- Chi phí vận hành = 0 ở giai đoạn MVP.
- Mở bằng URL trên điện thoại là test được, không cần cài app.
- Chỉ một chế độ tính điểm → ít bề mặt NLU cần test.

Tradeoffs:

- Phụ thuộc Chrome; Safari/iOS hỗ trợ Web Speech API kém hơn — cần kiểm chứng sớm
  nếu người chơi dùng iPhone.
- Quota 1000 req/ngày là trần cứng; vượt thì phải chờ sang ngày.
- Có thêm một tiến trình server phải chạy, dù rất nhỏ.

## Follow-Up

- Đo độ chính xác nhận dạng tiếng Việt thực tế trong 1–2 phiên chơi thật. Nếu
  không đạt, xem lại lựa chọn STT (đây là giả định rủi ro nhất của MVP).
- Kiểm tra trên iPhone/Safari sớm.
- Khi cần `rank`, mở lại [`scoring.md`](../product/scoring.md).
