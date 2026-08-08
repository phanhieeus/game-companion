# Stage 03 — PRD

1-2 pages max. Test: could a stranger build v1 from this without asking you anything?

## Gate — check ALL before `/flow next`
- [x] Every section below is filled from MY scope decision (stage 02), not re-expanded
- [x] Success metric is a NUMBER, not vibes
- [x] Each feature names the user action and the observable result
- [x] Pain & gain is a MAPPING TABLE with evidence and feature traceability
- [x] A stranger could build v1 from this without asking me anything
- [x] No FILL placeholders remain in this file

## Context

App ghi điểm bài bằng giọng nói đã chạy được: nói một câu → agent hiểu → đọc lại
xác nhận → ghi điểm. Phần lõi đã có test (44 unit + 16 e2e xanh). Vòng này giải
quyết hai chỗ đau còn lại sau khi dùng thử: **không nhìn được diễn biến từng ván**
(chỉ thấy điểm tổng và 4 ván gần nhất dạng danh sách), và **không có đường lui
khi giọng nói không dùng được** (micro chặn hoặc hết quota — cả hai đã xảy ra).
Chi tiết sản phẩm nền: [`docs/product/`](../docs/product/).

## Target users

Nhóm 4–5 người chơi bài trực tiếp, cùng bàn, dùng điện thoại Android/Chrome.
Một người cầm máy ghi điểm cho cả làng. Không có tài khoản, không đăng nhập.
Bằng chứng: stage 00 (nhóm có thật, chính là người test), stage 01 (kênh người
dùng đầu tiên = chính cái bàn đó).

## Pain & gain (mapping table — the traceability spine of the PRD)

| # | Persona | Pain (concrete) | Evidence | Today's workaround | V1 feature that kills it | Observable gain |
|---|---|---|---|---|---|---|
| P1 | Người cầm máy | Chỉ thấy điểm tổng, không truy được ai mất điểm ở ván nào | Denexa review: *"doesn't keep track of each score event individually… may be a deal-breaker"* (stage 01, complaint #2) | Ghi thêm ra giấy song song, hoặc chịu | Bảng nhiều cột: mỗi hàng một ván, mỗi cột một người | Nhìn một bảng thấy được toàn bộ diễn biến trận |
| P2 | Cả làng | Cãi nhau "ván 3 tao có mất 2 điểm đâu" mà không tra lại được | Quan sát trực tiếp: luật tổng-bằng-0 trong [`SPEC.md`](../SPEC.md) tồn tại chính vì nhóm hay cộng sai khi ghi tay | Nhớ mồm, hoặc bỏ qua | Cột số ván + delta từng người từng ván | Chỉ vào đúng hàng ván 3 để đối chiếu |
| P3 | Người cầm máy | Chơi 20+ ván thì trang dài, cuộn tay tìm chỗ mất thời gian giữa ván | Quan sát: 4 ván đã chiếm gần hết màn hình ở layout cũ | Cuộn tay | Nút đổi thứ tự + nút về đầu trang + bảng tổng gọn lại | Ván vừa ghi luôn nằm sát nút Voice, không phải cuộn |
| P4 | Người cầm máy | Micro bị chặn hoặc hết quota giữa ván → app thành vô dụng, không có cách nào ghi tiếp | Đã xảy ra thật 2 lần: quota `gemini-2.5-flash-lite` 20 lượt/ngày (đo 2026-08-08); Chrome chặn micro trên origin không an toàn (xem [decision 0002](../docs/decisions/0002-mvp-stack-web-app-free-providers.md)) | Quay về giấy bút, và không quay lại app | Nhập/sửa điểm bằng tay | Ghi tiếp được ván đang chơi mà không cần giọng nói |

### Pains NOT addressed in v1 (deliberate — tie to the scope cut list)

- **Không xem lại được các phiên đã kết thúc** → L-impact, đã cắt ở stage 02.
- **Không khoe được kết quả ra ngoài nhóm** → cắt cho tới khi voice được kiểm
  chứng bằng một phiên chơi thật; chưa có gì đáng lan truyền.
- **Sửa trực tiếp một ô trong bảng** → cắt; nhập tay (P4) đã đủ đường lui, còn
  sửa từng ô cần nghĩ kỹ về undo/audit.
- **Độ chính xác STT tiếng Việt** → vòng này KHÔNG chạm tới. Đây vẫn là rủi ro
  số 1 và chỉ đo được bằng một phiên chơi thật.

## Problem statement

Người ghi điểm không truy được diễn biến từng ván nên không giải quyết được tranh
cãi, và mất hoàn toàn khả năng ghi điểm khi giọng nói không dùng được.

## Features (user-centric — action → observable result)

- Là người cầm máy, **tôi nhìn bảng điểm theo ván**, và thấy mỗi hàng là một ván
  với số ván ở cột đầu, mỗi người một cột, ô là điểm ván đó (`+3` / `−1`).
- Là người cầm máy, **tôi bấm nút đổi thứ tự**, và bảng lật giữa ván-mới-nhất-ở-dưới
  (mặc định) và ván-mới-nhất-ở-trên; lựa chọn được nhớ lại khi mở lại app.
- Là người cầm máy, **tôi bấm nút về đầu trang**, và trang cuộn lên đầu.
- Là người cầm máy, **tôi nhìn bảng tổng gọn ở trên**, và vẫn thấy hạng + điểm
  tổng mà không bị đẩy mất nút Voice khỏi màn hình.
- Là người cầm máy, **tôi bấm "Nhập tay", gõ điểm cho từng người rồi bấm Ghi**,
  và ván được ghi y như khi nói — cùng ràng buộc tổng = 0, cùng hiện trong bảng.

## Non-functional requirements

- Mobile-first: vừa màn hình 360px với 5 người (6 cột) mà **không cuộn ngang** —
  co cỡ chữ theo số người chơi.
- Nút Voice phải luôn nằm trong tầm ngón tay cái, không bị bảng đẩy khỏi màn hình.
- Không đăng nhập, không backend mới; dữ liệu vẫn ở localStorage.
- Mọi thay đổi điểm vẫn đi qua tool layer hiện có (hợp đồng ở
  [`docs/product/tools.md`](../docs/product/tools.md), decision 0001).
- Chữ tiếng Việt có dấu.

## Tech stack

Không đổi so với app hiện tại — xem
[`decision 0002`](../docs/decisions/0002-mvp-stack-web-app-free-providers.md).
Frontend React 19 + Vite + TypeScript, state trong localStorage, proxy Express
giữ Gemini key, test Vitest + Playwright. Vòng này **không thêm dependency nào**.

## Success metric (numbers only)

- Bảng hiện đúng **100%** số ván đã ghi, và tổng mỗi cột **khớp chính xác** điểm
  trong bảng xếp hạng (kiểm bằng e2e với 3 ván).
- Với **5 người chơi** (6 cột) trên viewport **360px**: `scrollWidth === clientWidth`
  của bảng — tức không cuộn ngang (kiểm bằng e2e).
- Nút Voice vẫn nhìn thấy được **không cần cuộn** sau khi ghi **10 ván**
  (kiểm bằng e2e: nút nằm trong viewport).
- Ghi được một ván **không dùng giọng nói**, từ lúc bấm "Nhập tay" đến khi bảng
  cập nhật, trong **≤ 4 thao tác chạm** ngoài việc gõ số.
