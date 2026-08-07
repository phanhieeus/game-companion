# Conversation — intent, trích tham số, xác nhận & sửa lỗi

Nguồn intent: [`SPEC.md`](../../SPEC.md) mục 8, 9, 11.

Đây là phần quyết định "dùng có sướng không".

## Intent MVP hỗ trợ

| Intent | Ví dụ câu nói | Hàm gọi |
|---|---|---|
| `record_round` | "Nam ăn 3, ba người kia chung 1" | `record_round` |
| `query_scoreboard` | "Ai đang dẫn?", "Bảng điểm sao rồi?" | `get_scoreboard` |
| `query_player` | "Tôi được bao nhiêu?", "Hùng mấy điểm?" | `get_player_score` |
| `undo_round` | "Nhầm rồi, hủy ván vừa nãy" | `undo_round` |
| `correct_round` | "Sửa lại ván nãy, Hùng -1 thôi" | `update_round` |
| `add_player` | "Thêm Minh vào" | `add_player` |
| `history` | "Ván trước ai thắng?" | `get_history` |
| `end_session` | "Kết thúc, tính tổng đi" | `end_session` |

Ngoài danh sách → agent nói không hỗ trợ và gợi ý việc làm được.

## Trích tham số

- **Người**: ánh xạ tên nói ra → `player_id` trong phiên. Tên lạ → Clarifying.
  Xử lý biến thể ("tôi/tao/mình" = người đang cầm máy nếu đã biết là ai —
  xem [`open-questions.md`](open-questions.md) câu 7).
- **Số điểm / dấu**: "ăn/thắng" = dương, "chung/thua/đền" = âm; đọc số tiếng Việt.
- **Thứ hạng** (chế độ rank): "nhất/nhì/ba/bét…" → rank.
- **Cụm gộp**: "ba người kia mỗi người chung 1" → suy ra 3 người còn lại, mỗi người −1.

### Ràng buộc để hiểu đúng

- Ở chế độ `direct` + `zero_sum`: nếu tổng nói ra ≠ 0, **không tự bịa** cho đủ —
  hỏi lại hoặc đề xuất cách chia rồi xác nhận.
- Nếu chỉ nói người thắng: hỏi ai chung / chia thế nào (ví dụ D2 bên dưới).

## Ba cơ chế hội thoại

### 1. Xác nhận trước khi ghi (confirm-before-commit)

- **Mọi hành động thay đổi điểm** (`record`, `correct`, `undo`) → agent **đọc lại
  tóm tắt** rồi chờ "ừ/đúng/ok". Chỉ khi được đồng ý mới gọi hàm.
- **Tra cứu** → trả lời thẳng, không cần xác nhận.
- Tùy chọn tắt xác nhận cho người chơi quen — mặc định **bật**
  (chưa chốt có làm hay không, xem [`open-questions.md`](open-questions.md) câu 3).

### 2. Làm rõ khi thiếu/mập mờ (clarify)

- Thiếu thông tin (ai chung? bao nhiêu?) → hỏi **đúng 1 câu ngắn**, không tra hỏi dồn.
- Tên lạ → hỏi "thêm người này hay bạn nói ai khác?".
- Mập mờ số → đọc lại con số nghe được để xác nhận.

### 3. Sửa lỗi nhanh (repair)

- Ngay khi xác nhận: người dùng nói khác đi → agent cập nhật bản nháp rồi xác nhận lại.
- Sau khi đã ghi: "hủy ván vừa rồi" → `undo`; "sửa ván nãy…" → `update`.
- Undo mặc định tác động **ván gần nhất**; muốn ván khác thì nói rõ ("ván thứ 3").

## Ví dụ hội thoại

Các ví dụ này là đặc tả behavior — dùng làm cơ sở cho test hội thoại.

> Giả định phiên 4 người: **Nam, Hùng, Lan, Tú**. "Bạn" = người cầm máy.

**D1 — Ghi điểm (direct, zero-sum) có xác nhận**
```
Bạn:   (nhấn nút) "Ván này Nam ăn 3, ba người kia mỗi người chung 1."
Agent: "Nam +3, Hùng −1, Lan −1, Tú −1. Ghi ván này nhé?"
Bạn:   "Ừ."
Agent: "Xong ván 5. Nam đang dẫn với 12 điểm."
```

**D2 — Thiếu thông tin → làm rõ**
```
Bạn:   "Nam thắng 6."
Agent: "6 điểm này ai chung? Chia đều 3 người còn lại nhé?"
Bạn:   "Ừ chia đều."
Agent: "Nam +6, Hùng −2, Lan −2, Tú −2. Ghi nhé?"
Bạn:   "Ok."
Agent: "Đã ghi ván 6."
```

**D3 — Chế độ rank**
```
Bạn:   "Nam nhất, tôi nhì, Hùng ba, Lan bét."
Agent: "Nam +3, bạn +1, Hùng −1, Lan −3. Ghi nhé?"
Bạn:   "Đúng rồi."
Agent: "Ghi xong. Bạn đang hạng 2."
```

**D4 — Tra cứu bảng điểm (không cần xác nhận)**
```
Bạn:   "Ai đang dẫn?"
Agent: "Nam dẫn với 12 điểm. Kế đó Tú 4, bạn 1, Lan −3, Hùng −14."
```

**D5 — Hỏi điểm một người**
```
Bạn:   "Tôi được bao nhiêu rồi?"
Agent: "Bạn đang có 1 điểm, hạng 3."
```

**D6 — Hủy ván nhầm**
```
Bạn:   "Nhầm rồi, hủy ván vừa nãy."
Agent: "Đã hủy ván 6. Bảng điểm quay lại: Nam 9, Tú 3, bạn 1, Lan −1, Hùng −12."
```

**D7 — Tên lạ → làm rõ**
```
Bạn:   "Minh thắng 3."
Agent: "Mình chưa thấy Minh trong phiên. Thêm Minh vào chơi hay bạn nói người khác?"
Bạn:   "À Hùng, không phải Minh."
Agent: "Hùng +3, còn ai chung 3 điểm này?"
```

**D8 — Từ chối xác nhận rồi sửa**
```
Agent: "Nam +3, Hùng −3. Ghi nhé?"
Bạn:   "Không, Hùng −1 thôi, còn lại chia Lan với Tú."
Agent: "Nam +3, Hùng −1, Lan −1, Tú −1. Ghi nhé?"
Bạn:   "Ừ."
Agent: "Đã ghi."
```
