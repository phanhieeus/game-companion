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
| 9 | **Sửa rỗng không ghi nhật ký** (2026-08-08) | Mở ô ra xem rồi bấm Lưu mà không đổi gì thì không phải là một thay đổi. Ghi vào nhật ký sẽ làm nhiễu chỗ cần đọc nhanh, đánh dấu nhầm ván là "đã sửa", và tệ nhất là đẩy con trỏ undo — xoá nhánh làm lại một cách vô cớ | Ghi mọi lần bấm Lưu cho "đầy đủ": nhật ký đầy mục rỗng, dấu ˟ mất hết ý nghĩa vì ván nào cũng có |
| 8 | **Mọi thay đổi ván ghi vào audit log bất biến** (2026-08-08) | Cho sửa trực tiếp mà không truy được ai sửa gì lúc nào thì mất luôn khả năng giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Log là điều kiện để mở tính năng sửa, không phải tính năng phụ | Chỉ giữ trạng thái hiện tại: đơn giản hơn nhưng "ván 3 sao khác lúc nãy" thành không trả lời được |

| 10 | ~~**Vòng lặp ReAct chạy ở CLIENT, server chỉ là proxy LLM**~~ — **ĐẢO NGƯỢC cùng ngày, xem quyết định 13** (2026-08-08) | Tool thao tác trên localStorage nên phải chạy ở trình duyệt. Để server chạy vòng lặp thì phải đẩy toàn bộ state lên rồi kéo về mỗi bước. Client giữ vòng lặp, server giữ API key — mỗi bên giữ đúng thứ chỉ mình có | Agent chạy hẳn trên server: đúng sách vở hơn, nhưng phải đồng bộ state hai chiều mỗi bước cho một app một-người-dùng chạy trên một máy |
| 11 | **Chặn cứng số bước ReAct** (2026-08-08) | Mỗi bước là một lượt gọi Gemini. Free tier có hạn và đã sập một lần. Vòng lặp không chặn có thể đốt sạch quota trong một câu nói lỗi | Để agent tự quyết khi nào dừng: đúng tinh thần agent, nhưng một vòng lặp hỏng là mất cả ngày dùng app |
| 12 | **HITL nằm ở TOOL, không ở model** (2026-08-08) | Mỗi tool tự khai báo có cần xác nhận không. Model không được quyền bỏ qua bước hỏi — nó chỉ đề xuất, code quyết định. Giữ đúng ranh giới decision 0001 | Để model tự chọn khi nào hỏi: prompt đổi hoặc model đổi là mất chốt an toàn, mà đây là chốt duy nhất chặn ghi sai điểm |
| 13 | **Server giữ dữ liệu phiên và chạy cả vòng ReAct — ĐẢO NGƯỢC quyết định 10, ghi đè quyết định 2** (2026-08-08) | Operator chốt: ranh giới client/server phải chuẩn. Backend sở hữu miền nghiệp vụ (Session, tool layer, agent); frontend chỉ trình bày và thu thao tác. Nhờ vậy tool chạy cùng chỗ với dữ liệu, không còn cảnh client gửi khai báo tool lên server mỗi bước, và system prompt + danh mục tool nằm chung một nơi | Giữ vòng lặp ở client (quyết định 10): ít việc hơn nhiều và vẫn chạy offline, nhưng logic agent nằm rải hai bên, server không kiểm được nó đang môi giới tool gì |
| 14 | **Lưu bằng file JSON trên đĩa, chưa dùng CSDL** (2026-08-08) | Một máy, một người ghi, vài chục phiên. File JSON ghi nguyên khối là đủ và đọc được bằng mắt khi cần soi. Đổi sang SQLite sau chỉ phải thay lớp repository — chữ ký đã có sẵn từ decision 0001 | SQLite ngay: đúng hơn khi nhiều người ghi cùng lúc, nhưng thêm dependency gốc và một lớp migration cho bài toán chưa có |
| 16 | **Backend viết bằng Python + FastAPI** (2026-08-08) | Operator chọn sau khi nghe rõ cái giá. Ranh giới của quyết định 13 không đổi — chỉ đổi ngôn ngữ hiện thực nó. Đổi lại được hệ sinh thái Python cho phần dữ liệu/ML về sau, và một backend đọc quen mắt hơn với người làm Python | Giữ TypeScript: đã có 129 test xanh, một `npm ci` duy nhất, và `shared/types.ts` cho cả hai phía dùng chung MỘT định nghĩa. Đổi sang Python phải dịch tay ~1.500 dòng nghiệp vụ, viết lại 113 test server, và mất kiểu dùng chung — client phải khai lại hoặc sinh từ OpenAPI |
| 17 | **Kiểu qua dây sinh từ OpenAPI, không khai tay hai lần** (2026-08-08) | Backend Python và client TypeScript không còn chung `shared/types.ts` nữa. Khai `Session`/`Round` ở hai nơi thì sớm muộn cũng lệch, mà lệch kiểu này im lặng: test hai bên đều xanh, chỉ có người dùng thấy sai | Khai tay hai bản: nhanh hơn lúc đầu, nhưng đúng loại drift mà stage 05 (contract) tồn tại để chặn |
| 15 | **Định danh phiên bằng id trong URL, vẫn KHÔNG auth** (2026-08-08) | Quyết định 2 bỏ auth vì cả nhóm ngồi chung bàn — điều đó không đổi. Cái đổi là dữ liệu giờ nằm ở server, nên cần một cách trỏ tới đúng phiên: id ngẫu nhiên trong URL, client nhớ id gần nhất | Thêm tài khoản: đúng lý do quyết định 2 đã bác — không pain nào trong PRD cần tới, mà thêm cả một bề mặt hỏng |

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
