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

## NOT doing in v1 (and why it's safe to skip)

- **Sửa trực tiếp từng ô trong bảng** — nút Hủy cả ván + nhập tay đã đủ đường lui.
  Sửa từng ô cần nghĩ kỹ về audit/undo, chưa đáng lúc này.
- **Virtualise bảng khi nhiều ván** — một phiên bài thực tế cỡ 10–40 ván, DOM
  ngần đó hàng không chậm. Tối ưu trước khi đo là lãng phí.
- **Biểu đồ xu hướng điểm** — bảng theo ván đã cho thấy xu hướng; biểu đồ là
  L-impact, đã cắt ở stage 02.
- **Đồng bộ nhiều máy / xem chung thời gian thực** — grade C, không pain nào
  trong PRD cần tới.
- **Đổi cách tính điểm (`rank` mode)** — vẫn ngoài phạm vi MVP theo decision 0002.
