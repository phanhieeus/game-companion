---
name: standup
description: "Gợi ý nội dung cho báo cáo standup hàng ngày. Dùng khi sinh viên nói 'standup', 'daily', 'báo cáo', 'hôm qua làm gì', 'hôm nay làm gì', hoặc cần chuẩn bị nội dung trước khi nộp standup trên Discord. Skill này gợi ý thông tin từ git log và GitHub Project — sinh viên tự viết báo cáo."
---

# Standup — Gợi ý nội dung báo cáo hàng ngày

Sinh viên A20 phải nộp standup hàng ngày trên Discord qua bot. Báo cáo gồm 3 phần:
1. **Hôm qua đã làm gì**
2. **Hôm nay sẽ làm gì**
3. **Blockers**

Skill này giúp gợi ý nội dung từ dữ liệu thực (git commits, GitHub Project board) để sinh viên viết nhanh hơn. Đây là công cụ gợi ý — không tự điền hay thay thế báo cáo.

## Khi nào chạy

Khi sinh viên nói: "standup", "daily", "báo cáo", "hôm qua mình làm gì nhỉ", "chuẩn bị standup", hoặc tương tự.

## Thu thập dữ liệu

Chạy song song:

**Git log:**
```bash
# Commits hôm qua
git log --oneline --since="1 day ago" --format="%h %s"
# Nếu trống, thử 2 ngày
git log --oneline --since="2 days ago" --format="%h %s"
```

**GitHub Project (nếu có):**
```bash
# Tìm project ID liên quan đến repo hiện tại
REPO_NAME=$(basename $(git remote get-url origin 2>/dev/null) .git 2>/dev/null)
ORG=$(git remote get-url origin 2>/dev/null | sed 's/.*[:/]\([^/]*\)\/[^/]*/\1/')
gh project list --owner "$ORG" --format json 2>/dev/null
```

Nếu tìm được project, lấy items:
```bash
gh project item-list {PROJECT_NUMBER} --owner {ORG} --format json --limit 30 2>/dev/null
```

Phân loại items theo status:
- **Done** (hoặc tương đương) → gợi ý cho "Hôm qua"
- **In Progress** → gợi ý cho "Hôm nay"
- Items assignee trùng user hiện tại ưu tiên trước

**Issues:**
```bash
gh issue list --assignee @me --state open --limit 10 2>/dev/null
```

## Hiển thị gợi ý

Trình bày dạng gợi ý, không phải báo cáo hoàn chỉnh:

```
📋 Gợi ý cho standup hôm nay:

━━ Hôm qua đã làm gì ━━
Từ git commits:
  • abc123 — setup FastAPI endpoint /chat
  • def456 — thêm agent loop cơ bản
Từ GitHub Project (Done):
  • Task: "Setup API endpoint" ✅

━━ Hôm nay sẽ làm gì ━━
Từ GitHub Project (In Progress):
  • Task: "Implement memory cho agent"
  • Task: "Viết test cho agent loop"
Issues đang mở:
  • #3 — Fix timeout khi gọi API

━━ Blockers ━━
  (không tìm thấy blocker nào trong project)
  → Nếu có khó khăn gì, nhớ ghi vào nhé!

💡 Đây chỉ là gợi ý — hãy viết lại bằng lời của bạn khi nộp standup.
   Bổ sung những việc không có trên git (thảo luận, nghiên cứu, đọc tài liệu...).
```

## Khi không có dữ liệu

Nếu không có commits VÀ project trống:

```
📋 Mình không tìm thấy commits hay tasks nào gần đây.

Gợi ý:
  1. Thêm tasks vào GitHub Project → lần sau standup sẽ có gợi ý
  2. Commit code thường xuyên, kể cả thay đổi nhỏ
  3. Nếu hôm qua bạn làm việc không liên quan code (đọc tài liệu,
     thảo luận nhóm, nghiên cứu...) thì ghi trực tiếp vào standup

💡 Standup không chỉ về code — thảo luận, học, research đều đáng ghi!
```

## Nguyên tắc

- **Tiếng Việt**, giọng thân thiện
- **Gợi ý, không thay thế** — luôn nhắc sinh viên viết lại bằng lời mình
- **Nhanh** — chạy xong trong vài giây, không hỏi thêm gì
- **Không sửa file** — skill này chỉ đọc và hiển thị, không ghi gì
- Nhắc sinh viên bổ sung việc ngoài code (thảo luận, nghiên cứu, họp nhóm)
