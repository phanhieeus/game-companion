# Câu hỏi mở — CHƯA CHỐT

Nguồn: [`SPEC.md`](../../SPEC.md) mục 15.

> **Cảnh báo cho agent:** những câu dưới đây **chưa có authority**. Đừng tự chọn
> một phương án rồi code theo. Nếu một task chạm vào các điểm này, dừng lại và hỏi
> người quyết định trước khi sửa code. Khi chốt xong, ghi vào
> [`../decisions/`](../decisions/) và cập nhật doc product tương ứng.

Chốt được câu 1–3 là đủ để bắt đầu build; 4–7 quyết định hạ tầng, có thể bàn song song.

## Chặn việc bắt đầu build

1. **Chế độ điểm cần cho lần đầu:** `direct`, `rank`, hay cả hai? Chỉ cần một thì
   cắt bớt cho gọn. → ảnh hưởng [`scoring.md`](scoring.md)
2. **Zero-sum:** luật bài có nhà cái / phạt cố định không? → ảnh hưởng cờ `zero_sum`
   và mã lỗi `SUM_DELTA_NOT_ZERO` trong [`tools.md`](tools.md)
3. **Xác nhận trước khi ghi:** bật mặc định (an toàn, chậm hơn một nhịp) hay cho
   tắt để nhập nhanh? → ảnh hưởng [`conversation.md`](conversation.md)

## Quyết định hạ tầng

4. **Lưu trữ:** mở lại app vẫn còn phiên đang chơi (cần local DB) hay chỉ trong
   phiên chạy?
5. **Ngôn ngữ giọng nói:** chỉ tiếng Việt, hay cả tiếng Anh? Ảnh hưởng chọn STT/TTS.
6. **STT/TTS dùng gì:** on-device hay cloud (độ trễ, chi phí, offline)?
7. **"Tôi/mình" là ai:** có cần biết người cầm máy là player nào không (để hiểu
   "tôi được bao nhiêu")? → ảnh hưởng trích tham số trong
   [`conversation.md`](conversation.md)

## Điểm mập mờ khác cần để ý

- Sửa `ScoringConfig` giữa phiên: spec nói ván đã ghi **không hồi tố**, nhưng chưa
  nói agent có phải cảnh báo người dùng khi bảng điểm trộn hai cấu hình hay không.
