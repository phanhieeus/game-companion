# 0001 Giữ hợp đồng tool tương thích với plugin platform tương lai

Date: 2026-08-08

## Status

Proposed

Bản spec nguồn ([`SPEC.md`](../../SPEC.md) v1.1) đang ở trạng thái "Draft để
review", nên quyết định này chưa được chấp nhận chính thức. Chuyển sang `Accepted`
khi spec được duyệt.

## Context

MVP Voice Card Scoring là **lát cắt dọc mỏng** của một kiến trúc lớn hơn: về sau
sẽ có plugin platform (Capability Registry, LLM Planner tách tầng, Tool Dispatcher
và Tool Registry tổng quát, Event Bus, Plugin Loader) và hỗ trợ nhiều game.

Những tầng đó **cố tình nằm ngoài phạm vi MVP** — xây bây giờ là over-engineering
khi chưa có game thứ hai để kiểm chứng abstraction. Nhưng nếu MVP đặt tên hàm và
schema tùy tiện, lúc ghép plugin platform vào sẽ phải viết lại business logic.

## Decision

MVP gọi thẳng các hàm ghi/tra cứu, **không** xây tầng trừu tượng tổng quát. Đổi
lại, phải giữ các ràng buộc sau ngay từ đầu:

1. Tên và schema các hàm trong [`../product/tools.md`](../product/tools.md) đặt
   đúng như "tool" trong kiến trúc đầy đủ. Sau này chỉ cần `register_tool()`.
2. Vòng "Intent → chọn hàm → gọi → trả lời" gọi trực tiếp, nhưng giữ ranh giới rõ
   để sau tách thành LLM Planner + Tool Dispatcher + Tool Registry mà **không đổi
   hợp đồng hàm**.
3. `ScoringConfig` + luật tính điểm gói gọn một chỗ, để sau bọc vào Manifest +
   Rule Engine của plugin.
4. Tách **Repository** khỏi logic tính điểm ngay từ MVP.
5. Mọi thao tác ghi điểm đi qua **một điểm duy nhất**, để sau gắn Event Bus. MVP
   chưa cần Event Bus — chỉ cần đừng rải logic ghi khắp nơi.

## Alternatives Considered

1. **Xây plugin platform ngay từ MVP.** Loại: chưa có game thứ hai để kiểm chứng
   abstraction, chi phí lớn, làm chậm việc xác nhận giả định cốt lõi (voice ghi
   điểm có đủ tin cậy để dùng thật không).
2. **Không quan tâm tương thích, MVP viết sao tiện thì viết.** Loại: sẽ phải viết
   lại business logic khi ghép platform, dù đó là phần đã được kiểm chứng kỹ nhất.

## Consequences

Positive:

- MVP giữ được kích thước nhỏ, tập trung vào giả định cốt lõi.
- Phần business logic đã kiểm chứng không phải viết lại khi lên platform.

Tradeoffs:

- Một vài chỗ trong MVP trông "trang trọng quá mức" so với nhu cầu hiện tại
  (ví dụ `client_request_id`, tách Repository).
- Ràng buộc này phải được nhắc lại khi review, nếu không sẽ trôi dần.

## Follow-Up

- Khi spec v1.1 được duyệt, đổi Status sang `Accepted`.
- Khi bắt đầu game thứ hai, xem lại decision này để quyết định thời điểm tách
  plugin platform thật.
