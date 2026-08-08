# Stage 01 — Research (inspect first)

Rule: INSPECT what already exists. Evidence required — links, quotes, screenshots.
"I think there's nothing like this" without searching = gate fail.

## Gate — check ALL before `/flow next`
- [x] I actually OPENED 3 existing tools/competitors (links below, with one honest note each)
- [x] I found 3 REAL user complaints online and quoted them (with source links)
- [x] I wrote what competitors CHARGE (real prices) and who is paying them
- [x] I named the ONE channel my first 10 users come from (a place, not "social media")
- [x] I wrote why those users would pick this over the status quo (one honest paragraph)
- [x] I wrote what is technically free vs hard for this idea
- [x] No FILL placeholders remain in this file

## What exists already (3 — open them, don't guess)

1. **Ghi Điểm Đánh Bài — Tiến Lên**
   (https://ghi-diem-danh-bai-tien-len.en.softonic.com/android) — đúng thị trường
   Việt Nam, đúng game. Miễn phí, thêm/xoá người chơi, đặt luật. Nhập điểm hoàn
   toàn bằng tay từng người. Không có giọng nói.
2. **Ghi Điểm Đánh Bài**
   (https://m.apkpure.com/ghi-%C4%91i%E1%BB%83m-%C4%91%C3%A1nh-b%C3%A0i/qng.trietnguyen.playingcardslogger)
   — tối đa 5 người, kết thúc theo số ván hoặc theo mốc điểm, ghi chú theo từng
   ván. Gần nhất với app này về data model. Vẫn nhập tay.
3. **Zero Sum Scorekeeper Assistant**
   (https://apps.apple.com/cd/app/zero-sum-scorekeeper-assistant/id6502570274) —
   xây thẳng trên luật zero-sum, tự điền điểm người cuối cùng cho nhanh. Đúng
   ràng buộc toán học của app này, nhưng iOS và vẫn là nhập tay.

**Kết luận thật thà:** thị trường này KHÔNG trống. Có app Việt, đúng game, miễn
phí. Điểm khác biệt duy nhất đáng kể là **giọng nói** — không app nào ở trên có.
Nếu voice không đủ chính xác thì app này không có lý do tồn tại.

## What users say (3 real complaints, quoted, with source)

Nguồn: bài review 5 app ghi điểm của Denexa Games
(https://www.denexa.com/blog/5-scorekeeping-apps-reviewed/).

> ⚠️ **Provenance nói rõ:** đây là lời của một người review (dùng thật cả 5 app),
> KHÔNG phải comment của người dùng cuối trên forum. Tôi đã tìm complaint trên
> Reddit/app store nhưng không lấy được quote trực tiếp có nguồn kiểm chứng được.
> Ghi đúng như vậy còn hơn bịa ra ba câu "người dùng nói".

1. > "You have to enter each player's score in turn order, and you cannot skip
   > over a player; you have to enter a zero if they didn't score. This is no big
   > deal for games where players only score at the end of a hand, but it would be
   > pretty frustrating to use in games where only one player scores on each hand."
   — Denexa, về **Score Counter**

2. > "this is the only app we reviewed that doesn't keep track of each score event
   > individually for later review or editing. Only the total scores are tracked,
   > which may be a deal-breaker for some players."
   — Denexa, về **Score!! Crowd**

3. > "it does have pop-up ads too. It wasn't immediately clear what triggers them,
   > so it's easy to accidentally touch an ad while trying to enter a score."
   — Denexa, về **ScoreKeeper Free**

**Complaint #2 chính là bằng chứng cho tính năng đang xây ở stage này:** chỉ giữ
điểm tổng mà không giữ được từng ván là "deal-breaker". Bảng điểm theo từng ván
không phải trang trí — nó là thứ người dùng bỏ app vì thiếu.

## GTM & business reality

Building is the cheap part now. Distribution and willingness-to-pay are where ideas die —
research them BEFORE planning, not after shipping.

### Who pays today, and how much (pricing reference points)

- **Keep Score GameKeeper** (https://apps.apple.com/us/app/-/id1140300229) —
  miễn phí 1 ván, sau đó **99¢ cho 10 ván mới**, hoặc **$3.99 vô hạn**. Có người
  trả tiền thật cho đúng việc "ghi điểm bài" — mức giá tham chiếu duy nhất tìm
  được là vài đô một lần.
- **Ghi Điểm Đánh Bài (Tiến Lên)** — miễn phí hoàn toàn. Ở thị trường Việt Nam,
  giá tham chiếu cho việc này thực tế là **0đ**.
- **Status quo là tờ giấy + cây bút** — 0đ. Cái người ta "trả" là thời gian giữa
  ván và những lần cãi nhau vì cộng sai.

**Đọc thẳng:** willingness-to-pay cho app này gần như bằng 0. Đây KHÔNG phải ý
tưởng kinh doanh. Nó là công cụ cho một nhóm cụ thể, và nên được đánh giá theo
tiêu chí đó, không phải theo doanh thu.

### The first-10-users channel (one, named)

**Nhóm chơi bài của chính chủ dự án** — 4–5 người, chơi trực tiếp, ngồi cùng bàn.
Không cần kênh phân phối: đưa điện thoại qua là xong. 10 người dùng đầu tiên đến
từ đúng cái bàn mà pain xảy ra.

Đây vừa là điểm mạnh (feedback loop ngắn nhất có thể) vừa là giới hạn phải nói
rõ: **không có kênh nào để đi xa hơn cái bàn đó.** Nếu sau này muốn mở rộng thì
phải tìm kênh mới — hiện chưa có, và đây là tín hiệu cần cân nhắc ở stage 02.

### Why switch (vs the status quo)

Nhóm này đang ghi giấy, không phải đang dùng app khác. Lý do đổi không phải "app
tôi đẹp hơn" mà là: tay đang cầm bài thì **nói một câu nhanh hơn gõ 4 con số**,
và luật tổng-bằng-0 được máy kiểm tự động nên hết cãi nhau vì cộng sai. Đổi lại,
họ phải chấp nhận nhận dạng giọng nói sai đôi lúc — nên bước xác nhận trước khi
ghi là điều kiện để họ chịu đổi, không phải tính năng phụ. Nếu voice sai nhiều
hơn lợi ích tiết kiệm được thì họ quay về giấy ngay, và đó là kết quả hợp lý.

## Technically free vs hard

- **Free (solved by libraries/platforms):** nhận dạng giọng nói tiếng Việt (Web
  Speech API, có sẵn trong Chrome, 0đ, không cần key); đọc lại bằng TTS; hiểu câu
  nói tự nhiên (Gemini function calling); lưu trữ (localStorage); UI (React).
- **Hard (custom work, real risk):**
  - **Độ chính xác STT tiếng Việt với TÊN NGƯỜI và CON SỐ** — rủi ro số 1, chưa
    đo được, và không có cách nào tránh: nghe nhầm "Hùng" thành "Hùn" hay "3"
    thành "13" là hỏng đúng thứ app hứa hẹn.
  - **Quota LLM miễn phí** — đã đo và đã sập một lần: `gemini-2.5-flash-lite` chỉ
    còn 20 lượt/ngày (đo 2026-08-08), không đủ một phiên. Xem
    [decision 0002](../docs/decisions/0002-mvp-stack-web-app-free-providers.md).
  - **Secure context** — Chrome chỉ cho dùng micro trên https/localhost, nên
    không thể chỉ "gửi link cho bạn bè trong nhà".
  - Suy luận cụm gộp tiếng Việt ("ba người kia mỗi người chung 1") và ràng buộc
    tổng = 0 — đã làm được, đo 10/10 trên `gemini-3.1-flash-lite`.
