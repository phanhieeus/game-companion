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

Mở **http://localhost:5173**.

Lấy Gemini API key miễn phí: https://aistudio.google.com/apikey

> ⚠️ **Phải mở bằng `localhost`, không phải IP LAN.** Chrome chỉ cho dùng micro
> trên "secure context": `https`, `http://localhost`, hoặc `http://127.0.0.1`.
> Mở qua `http://192.168.x.x:5173` thì Chrome **từ chối im lặng — không hiện hộp
> xin quyền**, nên trông như app hỏng. App sẽ cảnh báo nếu bạn mở sai địa chỉ.

## Test trên điện thoại

Địa chỉ `Network:` mà Vite in ra (`http://192.168.x.x:5173`) mở được trang nhưng
**micro sẽ không chạy** vì lý do trên. Ba cách xử lý, dễ nhất trước:

1. **Điện thoại Android nối USB — `adb reverse`.** Điện thoại nhìn máy tính như
   chính `localhost` của nó, nên thành secure context miễn phí:

   ```bash
   adb reverse tcp:5173 tcp:5173
   adb reverse tcp:8787 tcp:8787
   ```

   Rồi mở `http://localhost:5173` trên điện thoại.

2. **Cho phép riêng origin đó trong Chrome điện thoại.** Mở
   `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, thêm
   `http://192.168.x.x:5173`, bật lên rồi khởi động lại Chrome.

3. **Tunnel HTTPS** (`cloudflared tunnel --url http://localhost:5173` hoặc
   ngrok) — chạy được ở mọi máy, nhưng chậm hơn và cần cài thêm.

## Yêu cầu

- **Chrome trên Android hoặc máy tính.** Nhận dạng giọng nói dùng Web Speech API;
  Safari/iOS hỗ trợ kém — chưa kiểm chứng.
- Cần internet: cả nhận dạng giọng nói lẫn Gemini đều chạy trên mạng.
- Quota free tier khác nhau rất nhiều theo model. `gemini-2.5-flash-lite` chỉ còn
  **20 lượt/ngày** (đo 2026-08-08) — không đủ một phiên. Dùng
  `gemini-3.1-flash-lite`. Đừng tin con số trong bài blog, chạy `npm run check:nlu`.

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy web + API proxy cùng lúc |
| `npm test` | Unit test (domain, repository, tools, phrases) |
| `npm run test:e2e` | E2E Playwright — giả lập giọng nói, không cần micro |
| `npm run check:nlu` | Gửi câu tiếng Việt mẫu vào Gemini thật, kiểm intent |
| `npm run build` | Typecheck + build production |

> `npm run dev` KHÔNG tự nạp lại `server/index.js`. Sửa system prompt xong phải
> khởi động lại, nếu không sẽ tưởng sửa không ăn thua.

## Test khi không bật được micro

Web Speech API trong Chromium (bản Playwright tải về) không chạy nhận dạng thật,
nên STT là phần duy nhất phải thử tay trên Chrome thật. Mọi thứ **từ chữ trở đi**
đều test được:

- `npm run test:e2e` cài một `SpeechRecognition` giả trước khi trang load, rồi
  bơm thẳng câu nói vào. Không phải sửa dòng code production nào.
- `npm run check:nlu` gửi câu tiếng Việt mẫu vào Gemini thật để xem có hiểu đúng
  không (tốn 10 lượt quota).

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
