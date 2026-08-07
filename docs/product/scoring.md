# Scoring — cấu hình điểm, data model, cách tính

Nguồn intent: [`SPEC.md`](../../SPEC.md) mục 4–6.

## Bất biến cốt lõi

Điểm tổng **không lưu trực tiếp** mà cộng dồn từ các `Round` hợp lệ. Hủy/sửa ván =
đánh dấu ván rồi tính lại — **không bao giờ sửa tay điểm tổng**.

Đây là ràng buộc quan trọng nhất của phần scoring: mọi thay đổi điểm phải đi qua
`Round`/`ScoreEntry`, không có đường tắt ghi thẳng vào total.

## Scoring Config

Hỗ trợ 2 chế độ cho mỗi phiên (phủ phần lớn luật bài Việt). Có thể đặt bằng giọng
nói lúc tạo phiên ("chơi tính điểm theo hạng, nhất 3 nhì 1...") hoặc chọn nhanh
trên màn hình.

> Chế độ nào cần cho bản đầu tiên **chưa chốt** — xem
> [`open-questions.md`](open-questions.md) câu 1 và 2.

### Chế độ `direct` — nhập trực tiếp điểm ±

```yaml
mode: direct
starting_score: 0
zero_sum: true         # tổng điểm mỗi ván = 0 (điểm chuyển giữa người chơi)
allow_negative: true
```

### Chế độ `rank` — nhập thứ hạng, quy ra điểm

```yaml
mode: rank
starting_score: 0
rank_points: [3, 1, -1, -3]   # điểm cho hạng 1..N; độ dài = số người
tie_policy: split             # split | same
```

Cấu hình đặt khi tạo phiên và **sửa được giữa phiên**; ván đã ghi **không hồi tố**.

## Data Model

```text
Session 1──1 ScoringConfig
Session 1──* Player      (4–5)
Session 1──* Round
Round   1──* ScoreEntry
```

| Entity | Field chính |
|---|---|
| **Session** | id, name?, status(`active`/`ended`), scoring_config, created_at, ended_at? |
| **Player** | id, session_id, name, seat_no?, status(`active`/`removed`) |
| **Round** | id, session_id, sequence_no, status(`recorded`/`voided`), created_at, source(`voice`/`manual`) |
| **ScoreEntry** | id, round_id, player_id, rank?, delta |

`source` cho biết ván ghi bằng voice hay tay — hữu ích khi debug nhận dạng giọng nói.

## Scoreboard (derived, không lưu)

```text
total(player) = starting_score
              + Σ delta của ScoreEntry thuộc Round status = 'recorded'
```

```yaml
Scoreboard:
  rows: [{ player_id, name, total, rank }]   # rank 1 = cao nhất, cho đồng hạng
  rounds_played: integer
```

Ván `voided` bị loại khỏi phép tính — đó là cách undo hoạt động, không xóa dữ liệu.

## Ràng buộc validate

Các ràng buộc này thuộc về business logic, không phải tầng voice — xem mã lỗi
tương ứng trong [`tools.md`](tools.md).

- Số người chơi trong phiên: 4–5.
- `direct` + `zero_sum`: tổng delta mỗi ván phải = 0.
- `rank`: số hạng phải khớp số người, không trùng hạng (trừ khi `tie_policy` cho phép).
- Không ghi `ScoreEntry` cho người không thuộc phiên.
