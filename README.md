# Game Companion — Voice Card Scoring

Ghi điểm bài bằng giọng nói tiếng Việt. Nhấn giữ nút, nói một câu, agent đọc lại
để xác nhận rồi mới ghi.

Đây là consumer README. Tài liệu sản phẩm nằm ở [`docs/product/`](docs/product/);
spec gốc đóng băng ở [`SPEC.md`](SPEC.md).

## Chạy thử

```bash
npm install
cp .env.example .env      # rồi điền GEMINI_API_KEY
npm run dev
```

Mở http://localhost:5173. Để test trên điện thoại, mở địa chỉ `Network:` mà Vite
in ra (cùng mạng Wi-Fi).

Lấy Gemini API key miễn phí: https://aistudio.google.com/apikey

## Yêu cầu

- **Chrome trên Android hoặc máy tính.** Nhận dạng giọng nói dùng Web Speech API;
  Safari/iOS hỗ trợ kém — chưa kiểm chứng.
- Cần internet: cả nhận dạng giọng nói lẫn Gemini đều chạy trên mạng.
- Free tier Gemini: 1000 lượt/ngày, 15 lượt/phút.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy web + API proxy cùng lúc |
| `npm test` | Chạy test (domain, tools, phrases) |
| `npm run build` | Typecheck + build production |

## Kiến trúc

```
src/
  domain/       Logic tính điểm thuần, không I/O. Nguồn sự thật của điểm số.
  repository/   Lưu trữ (localStorage), tách khỏi logic tính điểm.
  tools/        11 hàm hợp đồng — tên/schema giữ nguyên cho plugin tương lai.
  nlu/          Suy intent từ câu nói (gọi qua proxy).
  conversation/ State machine một lượt nói + sinh câu trả lời tiếng Việt.
  voice/        Web Speech API (STT/TTS).
  ui/           React, responsive cho mobile.
server/         Proxy giữ Gemini API key. Key không bao giờ xuống trình duyệt.
```

Hai ràng buộc quan trọng nhất:

1. **Điểm tổng không lưu trực tiếp.** Bảng điểm luôn tính lại từ các ván có
   status `recorded`. Hủy ván = đánh dấu rồi tính lại, không sửa tay điểm tổng.
2. **Tên và schema của tool là hợp đồng ổn định** — xem
   [decision 0001](docs/decisions/0001-tool-contracts-forward-compatible-with-plugin-platform.md).

## Trạng thái

MVP đang xây — xem
[`docs/plans/active/voice-card-scoring-mvp.md`](docs/plans/active/voice-card-scoring-mvp.md).

Chưa kiểm chứng trên thực tế: **độ chính xác nhận dạng tiếng Việt khi nói số và
tên người**. Đây là giả định rủi ro nhất của MVP và cần chơi thật một phiên để đo.
