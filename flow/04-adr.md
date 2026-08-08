# Stage 04 — ADR (architecture decisions)

Short. The most valuable section is what you are NOT doing and why.

## Gate — check ALL before `/flow next`
- [x] Each decision has a one-line "why" and a one-line "what I rejected"
- [x] The NOT-doing list is written
- [x] Decisions cover: data storage, auth approach, deploy target
- [x] No FILL placeholders remain in this file

## Decisions

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| 1 | **Data storage: giữ nguyên localStorage, KHÔNG thêm gì cho bảng** | Bảng theo ván suy ra hoàn toàn từ `session.rounds` đã có — không thêm entity, không migration. Điểm tổng vẫn tính lại từ ván `recorded` (bất biến cốt lõi) | Thêm bảng `roundTotals` cache sẵn: nhanh hơn về lý thuyết, nhưng tạo nguồn sự thật thứ hai — đúng thứ bất biến của app cấm |
| 2 | **Auth: không có, không đổi** | Cả nhóm ngồi chung bàn, chung một máy. Thêm auth là thêm bề mặt hỏng mà không giải quyết pain nào trong PRD | Có tài khoản để đồng bộ nhiều máy — không ai xin, và stage 01 cho thấy không có kênh người dùng nào ngoài cái bàn đó |
| 3 | **Deploy: vẫn chạy local (`npm run dev`), chưa deploy** | Giả định rủi ro nhất (độ chính xác STT) chưa đo. Deploy trước khi biết app có dùng được không là làm ngược thứ tự | Deploy lên Cloudflare/Vercel ngay: cần HTTPS thật cho micro (đúng là có lợi), nhưng kéo theo quản lý secret + chi phí trước khi biết có đáng không. `adb reverse` đã đủ để test trên điện thoại |
| 4 | **Nhập tay đi qua đúng `record_round` của tool layer** | Một đường ghi điểm duy nhất → validate zero-sum, idempotency, undo, lịch sử đều dùng chung. Đúng decision 0001 (mọi ghi điểm qua một điểm duy nhất, để sau gắn Event Bus) | Cho form nhập tay ghi thẳng vào repository: ngắn hơn vài dòng, nhưng tạo đường ghi điểm thứ hai bỏ qua validate — chính xác cái bug mà zero-sum sinh ra để chặn |
| 5 | **Thứ tự bảng lưu vào localStorage riêng, không vào `Session`** | Đây là tuỳ chọn hiển thị của người cầm máy, không phải dữ liệu ván bài. Nhét vào `Session` là làm bẩn model và lẫn vào lịch sử ván | Thêm field vào `Session`: phải sửa type, repository, và mọi test đang dựng session — trả giá cho một tuỳ chọn UI |
| 6 | **Co cỡ chữ theo số người chơi thay vì cuộn ngang** | 6 cột vẫn vừa 360px nếu giảm cỡ chữ. Cuộn ngang giữa ván bài thì người cuối cùng bị khuất — đúng người hay bị quên nhất | Cuộn ngang với cột số ván dính trái: giữ chữ to, nhưng phải thao tác thêm mới thấy đủ làng |
| 7 | **Cho sửa ô tự do, chỉ chặn khi LƯU** (2026-08-08) | Sửa một ô thì tổng ván ≠ 0 ngay lập tức — chặn từng phím gõ thì không sửa được gì. Cho gõ thoải mái, hiện tổng lệch, chỉ ghi vào sổ khi về 0. Giữ nguyên lưới chống STT nghe nhầm số | Tự bù vào người khác: app tự đổi điểm người bạn không động tới, dễ gây cãi nhau — đúng thứ app sinh ra để tránh. Bỏ zero-sum khi sửa tay: mất lưới an toàn, bảng lệch mà không ai biết |
| 8 | **Mọi thay đổi ván ghi vào audit log bất biến** (2026-08-08) | Cho sửa trực tiếp mà không truy được ai sửa gì lúc nào thì mất luôn khả năng giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Log là điều kiện để mở tính năng sửa, không phải tính năng phụ | Chỉ giữ trạng thái hiện tại: đơn giản hơn nhưng "ván 3 sao khác lúc nãy" thành không trả lời được |

## NOT doing in v1 (and why it's safe to skip)

- ~~**Sửa trực tiếp từng ô trong bảng**~~ — **ĐẢO NGƯỢC 2026-08-08**, xem
  quyết định 7 và 8 ở bảng trên. Lý do cắt ban đầu là "cần nghĩ kỹ về audit/undo";
  operator yêu cầu làm kèm audit log, tức là giải đúng cái lo ngại đó thay vì
  lách qua nó. Quyết định cũ giữ lại gạch ngang làm bản ghi, không xoá.
- **Virtualise bảng khi nhiều ván** — một phiên bài thực tế cỡ 10–40 ván, DOM
  ngần đó hàng không chậm. Tối ưu trước khi đo là lãng phí.
- **Biểu đồ xu hướng điểm** — bảng theo ván đã cho thấy xu hướng; biểu đồ là
  L-impact, đã cắt ở stage 02.
- **Đồng bộ nhiều máy / xem chung thời gian thực** — grade C, không pain nào
  trong PRD cần tới.
- **Đổi cách tính điểm (`rank` mode)** — vẫn ngoài phạm vi MVP theo decision 0002.
