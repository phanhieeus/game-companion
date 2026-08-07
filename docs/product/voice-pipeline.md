# Voice Pipeline — state machine một lượt nói

Nguồn intent: [`SPEC.md`](../../SPEC.md) mục 3 và 7.

Không nghe liên tục. Mỗi lượt bắt đầu bằng việc người dùng nhấn nút Voice.

```text
Idle
  │ (nhấn nút Voice)
  ▼
Listening ──► Understanding ──► [Clarifying] ──► [Confirming] ──► Executing ──► Responding ──► Idle
   STT           NLU/LLM         hỏi lại nếu       đọc lại &        gọi hàm         TTS
                                 thiếu tin        chờ "ừ"          ghi/tra cứu
```

| Trạng thái | Việc làm |
|---|---|
| **Idle** | Chờ, không thu âm. Màn hình hiện bảng điểm. |
| **Listening** | Thu âm khi giữ nút; nhả tay → dừng. STT ra text. |
| **Understanding** | LLM suy Intent + trích tham số (ai, bao nhiêu, hạng…). |
| **Clarifying** | Nếu thiếu/mập mờ → hỏi lại 1 câu ngắn, quay lại Listening. |
| **Confirming** | Với hành động **ghi điểm** → đọc lại, chờ xác nhận. |
| **Executing** | Gọi hàm tương ứng (record/query/undo…). |
| **Responding** | Sinh câu trả lời tự nhiên + TTS, rồi về Idle. |

`Clarifying` và `Confirming` là tùy lượt: tra cứu bỏ qua cả hai, ghi điểm luôn đi
qua `Confirming` (xem [`conversation.md`](conversation.md)).

## Xử lý lỗi

Lỗi ở bất kỳ đâu (STT trống, hàm trả lỗi) → về **Responding** với câu lỗi thân
thiện ("Mình chưa nghe rõ, nói lại giúp nhé"), rồi Idle.

**Không ghi gì khi lỗi.** Một lượt hỏng phải để lại state y như trước khi nói.

## Chưa chốt

STT/TTS on-device hay cloud, và ngôn ngữ hỗ trợ — xem
[`open-questions.md`](open-questions.md) câu 5 và 6. Cả hai ảnh hưởng độ trễ của
`Listening` → `Understanding` và khả năng chạy offline.
