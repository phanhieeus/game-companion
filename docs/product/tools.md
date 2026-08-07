# Tool Layer — hợp đồng các hàm ghi/tra cứu

Nguồn intent: [`SPEC.md`](../../SPEC.md) mục 10.

MVP chưa cần Tool Registry động — LLM gọi trực tiếp các hàm dưới đây (qua cơ chế
tool/function-calling).

> **Tên và schema của các hàm này là hợp đồng ổn định.** Đừng đổi tùy tiện — xem
> [decision 0001](../decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md).

## Hợp đồng

```text
create_session(name?, scoring_config, players[])         → { session_id, scoreboard }
add_player(session_id, name, seat_no?)                    → { player_id }
remove_player(session_id, player_id)                      → { ok }
update_scoring_config(session_id, scoring_config)         → { ok }

record_round(session_id, entries[], client_request_id?)   → { round_id, scoreboard }
      # direct: entries=[{player_id, delta}] · rank: entries=[{player_id, rank}]
update_round(session_id, round_id, entries[])             → { scoreboard }
undo_round(session_id, round_id?)                         → { voided_round_id, scoreboard }

get_scoreboard(session_id)                                → Scoreboard
get_player_score(session_id, player_id)                   → { name, total, rank }
get_history(session_id, limit?)                           → { rounds[] }
end_session(session_id)                                   → { scoreboard }
```

## Kết quả & lỗi

```yaml
Result: { ok: boolean, data: object|null, error: { code, message } }
```

| Mã lỗi | Khi nào |
|---|---|
| `SESSION_NOT_FOUND` | session không tồn tại |
| `PLAYER_NOT_IN_SESSION` | ghi cho người không thuộc phiên |
| `TOO_FEW_PLAYERS` / `TOO_MANY_PLAYERS` | ngoài 4–5 |
| `SUM_DELTA_NOT_ZERO` | direct + zero_sum, tổng ván ≠ 0 |
| `RANK_COUNT_MISMATCH` / `DUPLICATE_RANK` | lỗi nhập hạng |
| `NO_ROUND_TO_UNDO` | không còn ván để hủy |

## Idempotency

`client_request_id` để không ghi trùng nếu STT/mạng lặp yêu cầu. Hai lần gọi
`record_round` cùng `client_request_id` chỉ tạo một `Round`.

## Ràng buộc triển khai

- Tách **Repository** khỏi logic tính điểm ngay từ MVP.
- Mọi ghi điểm đi qua **một điểm duy nhất** để sau gắn Event Bus — MVP chưa cần
  Event Bus, chỉ cần đừng rải logic ghi khắp nơi.
