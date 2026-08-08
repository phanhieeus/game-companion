# Stage 02 — Scope (go/no-go)

Scope = features chosen by IMPACT × COST, inside your time budget.
KILL here is cheap and smart. Killing a weak idea at this gate is a SUCCESS outcome.

> Phạm vi stage này: **vòng cải tiến bảng điểm**, trên nền app đã chạy được
> (voice → intent → xác nhận → ghi điểm, 44 unit + 16 e2e đang xanh). Không
> re-scope lại cả sản phẩm.

## Impact rubric (business value — score BEFORE looking at cost)

| Impact | Meaning |
|---|---|
| H | moves money or the core promise: gets users in (acquisition), gets them paying (revenue), or delivers the one job they came for |
| M | keeps users / saves real time weekly (retention, operations) |
| L | nice-to-have; nobody would pay for or switch over it |

## AI coding grade rubric

| Grade | Meaning |
|---|---|
| A | cheap for AI — CRUD, forms, dashboards, API wrappers |
| B | moderate — file processing, integrations, single LLM call, HITL drafts |
| C | expensive — realtime, payments, custom auth, autonomous pipelines |

## Gate — check ALL before `/flow next`
- [x] Every feature below has an IMPACT (H/M/L with the business reason) AND a grade (A/B/C)
- [x] No L-impact feature above grade A survives in v1
- [x] The suggested-features section was actually considered (each suggestion has an in/out decision)
- [x] fit(grades, budget) holds — every C in scope is justified as path 1, 2, or 3 above
- [x] If the product IS a C feature: it is FIRST in build order, and its sibling C features are on the cut list
- [x] The cut list is written (what I am NOT building in v1)
- [x] GO / KILL decision is written below
- [x] No FILL placeholders remain in this file

## Time budget

**Re-budget sau khi duyệt scope: ~1.5 buổi (4–5 giờ).**

Ngân sách ban đầu là một buổi cho riêng phần bảng. Operator duyệt kéo thêm
"nhập điểm bằng tay" (suggestion 1, impact H) vào cùng vòng. Ghi lại việc nới
ngân sách thay vì giả vờ vẫn vừa — đây là path 3 trong rubric, và nói thật về
chi phí là điều kiện để lần sau ước lượng đúng.

## Features in v1 (each with impact AND grade)

- **Bảng điểm theo từng ván (nhiều cột, mỗi người một cột)** — impact **H**
  (core job: complaint #2 ở stage 01 nói thẳng "chỉ giữ điểm tổng, không giữ được
  từng ván" là *deal-breaker*. Đây đúng là thứ người ta bỏ app vì thiếu) —
  grade **A** (bảng tĩnh, dữ liệu đã có sẵn trong `session.rounds`).
- **Ghi điểm mỗi ván vào từng hàng, số ván ở cột đầu** — impact **H** (cùng lý do
  trên; đây là hình dạng của tính năng) — grade **A**.
- **Nút đổi thứ tự ván (mới nhất trên ↔ dưới), mặc định mới nhất ở DƯỚI** —
  impact **M** (retention: đọc xuôi như sổ ghi tay, ván vừa ghi nằm ngay trên nút
  Voice nên không phải cuộn giữa ván bài) — grade **A**.
- **Nút về đầu trang** — impact **L** — grade **A**. L-impact nhưng grade A nên
  được giữ theo đúng rubric. Chơi 20+ ván thì trang dài, cuộn tay bực.
- **Làm bảng tổng gọn lại** — impact **M** (giữ được cả hai bảng mà màn hình
  không bị đẩy dài; nếu không gọn thì bảng mới đẩy nút Voice xuống dưới màn hình
  — hỏng đúng thao tác chính) — grade **A**.
- **Nhập/sửa điểm bằng tay** — impact **H** (retention + core job: đường lui khi
  micro hoặc quota hỏng giữa ván — cả hai đã xảy ra thật) — grade **A**
  (form nhập số, đi qua đúng tool layer đã có, không thêm hạ tầng).

Không có feature grade B hoặc C trong vòng này. fit(grades, budget) thoả sau khi
nới ngân sách ở trên.

## Suggested features (impact-first — proposed, not decided)

Bám vào phát hiện GTM ở stage 01: kênh người dùng đầu tiên là **chính cái bàn
chơi bài**, ngoài ra không có kênh nào; willingness-to-pay ≈ 0.

1. **Nhập/sửa điểm bằng tay (không cần giọng nói)** — impact **H**
   (retention + core job). Lý do bám GTM: kênh duy nhất là cái bàn đó, nên **mất
   một lần là mất luôn** — không có nguồn người dùng mới bù vào. Stage 01 đã ghi
   hai cách hỏng đã xảy ra thật: quota 20 lượt/ngày, và Chrome chặn micro trên
   origin không an toàn. Cả hai đều khiến app thành vô dụng giữa ván, và hiện
   **không có đường lui nào** — họ về giấy và không quay lại. Grade **A**.
   → **IN** — operator duyệt kéo vào cùng vòng này (2026-08-08). Ngân sách được
   nới tương ứng ở trên. Đây là suggestion mạnh nhất trong ba cái.
2. **Chia sẻ kết quả cuối phiên (ảnh hoặc text vào chat nhóm)** — impact **M**
   (acquisition — đây là cơ chế lan truyền DUY NHẤT khả dĩ: người ở bàn gửi kết
   quả vào nhóm chat, người khác thấy app tồn tại). Grade **A**. → **OUT** —
   chưa có gì để lan truyền khi giả định cốt lõi (voice đủ chính xác) còn chưa
   được kiểm chứng bằng một phiên chơi thật.
3. **Xem lại các phiên đã kết thúc** — impact **L** (không ai đổi app vì cái này).
   Grade **A**. → **OUT** — L-impact, cắt khi ngân sách chật, đúng rubric.

## Cut list (NOT in v1 — deferred, not deleted)

- Chia sẻ kết quả — chờ sau khi voice được kiểm chứng thật.
- Lịch sử các phiên cũ — L-impact.
- Biểu đồ điểm theo thời gian — L-impact, và bảng đã cho thấy xu hướng rồi.
- Sửa trực tiếp một ô trong bảng — cần nghĩ kỹ về undo/audit; hiện đã có nút Hủy
  cả ván, đủ dùng.
- Cuộn ngang khi 5 người — đã chốt co chữ cho vừa màn hình thay vì cuộn.

## Decision

**GO** (operator duyệt 2026-08-08, kéo thêm nhập-điểm-bằng-tay vào scope) — mọi
feature đều grade A, hai feature H-impact về bảng dựa trên complaint có nguồn ở
stage 01, feature H thứ ba (nhập tay) dựa trên hai lần hỏng đã xảy ra thật.

Ghi rõ để khỏi tự lừa mình: **GO này không nói app sẽ thành công.** Giả định rủi
ro nhất — độ chính xác nhận dạng tiếng Việt với tên người và con số — vẫn chưa
được đo bằng một phiên chơi thật. Vòng này làm app dễ dùng hơn *nếu* giả định đó
đúng; nó không kiểm chứng giả định đó.
