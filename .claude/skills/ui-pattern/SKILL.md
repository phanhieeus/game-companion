---
name: ui-pattern
description: "Brainstorm partner for a new AI app idea. Takes a 1-paragraph idea, clarifies it through a short conversation, picks one of 7 UI patterns, then writes PRD.md + GUIDELINE.md into the repo. Use when user says 'help me spec this app', 'brainstorm my idea', 'viết spec / PRD cho app', 'chọn pattern / UI cho idea', 'bắt đầu app mới', 'blank page', 'I have an idea, help me turn it into a plan', 'app em sẽ như thế nào', or is at the blank-page moment before any code exists."
---

# UI Pattern — From idea to PRD + GUIDELINE in one conversation

User has an idea for an AI app and wants to start building. Blank-page paralysis is the #1 reason teams ship confused demos. This skill runs a **short brainstorm conversation** with the user, picks **one of 7 UI patterns**, then writes two files into the repo:

- `PRD.md` — problem, users, stories, data model, **tech stack (from user's brief)**, constraints, API surface, success criteria
- `GUIDELINE.md` — chosen UI pattern, T·C·R checklist, what NOT to build yet (references `PRD §Tech stack` for tech — doesn't restate it)

Stack is a **product decision**, not a UX decision. If the user briefs a stack in their paragraph (e.g., "Stack định dùng: React + Vite + Express mock"), the skill **records it verbatim into PRD**. The skill does NOT invent stack. If the user didn't mention one, the skill asks once before writing.

## What this skill does

1. Accepts a 1-paragraph idea from the user (or asks for one)
2. Asks 2–3 clarifying questions — adaptive, not a canned script
3. Picks one of the 7 UI patterns, explains why in one line
4. Writes `PRD.md` + `GUIDELINE.md` to the repo root
5. Tells the user what to paste next into Claude Code to start building

## When to use it

- User has an app idea but no PRD and no code
- User has a backend and wants to figure out the frontend
- User is re-spec'ing an abandoned repo
- Workshop/class context: student needs a paved path from idea to "ready to build"

If the team already has working UI, route them to `/tcr-apply` instead — that skill retrofits T·C·R on existing code.

## The 7 UI patterns

Memorize names — `/tcr-apply` and `/prd-to-screens` use the same list.

1. **Chat + context panel** — conversation left, evidence panel right. AI TA, RAG chatbot, Socratic tutor, admissions assistant.
2. **Upload → dashboard** — file in, structured insights out. Survey analysis, report summarizer, invoice extractor.
3. **Query → structured result** — NL question in, table/chart out. Text-to-SQL, digital twin Q&A, knowledge graph search.
4. **Wizard + inline audit** — multi-step form with AI checking each step. Syllabus generator, compliance-form builder, onboarding flow.
5. **Draft → approve → send** — AI drafts, human reviews + approves, system dispatches. Emergency comms, email assistant, scheduled announcements.
6. **Queue + approval** — batch of AI-labeled items, human clears the queue. Moderation, grading at scale, contract review.
7. **Real-time streaming** — live voice/video/text pipeline. Voice Q&A moderator, live transcription, streaming tutor.

### Meta-pattern — "Conversational UI + Evidence Panel"

Pattern 1 (Chat + panel) is secretly a meta-pattern: swap what the panel shows and it covers 5 other use cases:

- panel = **sources** → RAG chatbot
- panel = **progress** → long-running agent
- panel = **reasoning** → research / planning agent
- panel = **chart** → data Q&A
- panel = **queue** → inbox / approval

When in doubt between patterns 1, 3, and 6, default to **1** and choose the panel payload.

## Step 1 — Get the idea

If the user has already pasted an idea, summarize it back in one sentence to confirm. If they haven't, ask:

> **Mô tả ngắn ý tưởng của bạn:** app làm gì, ai dùng, giải quyết vấn đề gì? Nếu đã định stack rồi thì nói luôn.

Accept Vietnamese or English. Match the language they use.

## Step 2 — Clarify through conversation

Based on the idea, ask 2–3 short questions (one at a time) to remove uncertainty about *this specific idea*. You are not running a script. Pick from this pool only what's actually unclear:

- **Input:** User đưa gì cho app? (câu hỏi text / file / form / danh sách / voice)
- **Output:** User nhận lại gì? (text + nguồn / bảng biểu / bản nháp / danh sách đã gán label / stream)
- **Reversibility:** Hành động AI làm có undo được không? (chỉ đọc / edit lại / gửi đi luôn)
- **Roles:** 1 user hay nhiều role? (nếu nhiều, hỏi role nào là Demo 1, role nào là Demo 2)
- **Stack:** Nếu user chưa nói stack → "Bạn định dùng stack gì? (React + Vite + Express mock / Next.js / Streamlit / …) Hoặc cứ để mình gợi ý sau."
- **Constraints:** Có giới hạn nào nên ghi vào PRD không? (ví dụ: UX lab — không real backend, chỉ mock JSON; không auth; demo trên 1 máy)
- **Success metric:** Làm sao biết app thành công?

If the idea paragraph already covered everything, skip to Step 3 with one confirmation ("Tôi hiểu app của bạn là X, stack là Y, ràng buộc là Z. Đúng chưa?"). Do not ask questions for the sake of filling a form.

## Step 3 — Pick the UI pattern

Apply priority rules (top wins):

1. **Irreversible action** (send email, deduct money, publish publicly) → pattern 5.
2. **Batch work** (many items to approve/label) → pattern 6.
3. **Streaming** (voice, live video, live text) → pattern 7.
4. **Multi-step form** (user fills over time) → pattern 4.
5. **File upload** (CSV, PDF, audio, image) → pattern 2.
6. **Text question → chart/table output** → pattern 3.
7. **Text question → text + sources/reasoning output** → pattern 1.
8. **Still ambiguous** → default to 1 and set panel payload.

Tell the user the pattern + one-line reason. Offer the runner-up if the pick feels forced: "Mình chọn 1 vì Q+A dạng text. Nếu bạn thấy giống pattern 3 hơn (data analysis), nói mình biết."

## Step 4 — Write PRD.md

Write to `<repo-root>/PRD.md`. Overwrite if exists (warn + show diff first). Template:

```markdown
# PRD — {product name}

## Problem + context
{1–2 sentences on the pain. Add the "why now" or the lab/workshop/deadline context.
Examples: "UX lab build — kiểm chứng pattern chat+panel", "Demo nội bộ, không production".}

## Users
- **Primary:** {who uses it most, what they need}
- **Secondary:** {if any — e.g., admin, reviewer, teacher}

## User stories
3–5 stories. Tag each with **(Demo 1)**, **(Demo 2)**, or **(Later)**. Demo 1 = what gets built
from the first build prompt. Demo 2 = second surface (often a different role). Later = nice-to-have.

1. **(Demo 1)** As a {role}, {action} so that {outcome}.
2. **(Demo 1)** ...
3. **(Demo 2)** ...
4. **(Demo 2)** ...
5. **(Later)** ...

## Data model
Core entities + 3–5 fields each. Sketch only — no schema, no migrations.

- **{entity 1}** — {field, field, field}
- **{entity 2}** — {field, field, field}
- **{entity 3}** — {field, field, field}

## Tech stack
Copy verbatim from the user's brief. Skill does NOT invent. If the user didn't specify
a stack, this section says "TBD — ask before building".

- **Frontend:** {e.g., React 18 + Vite + plain JSX + inline styles}
- **Backend:** {e.g., Express mock serving JSON}
- **LLM:** {e.g., Gemini 2.5 Flash via src/llmService.js}
- **Storage:** {e.g., in-memory JSON, no DB}
- **Not using:** {things user explicitly ruled out — e.g., TypeScript, Tailwind, SQLite}

## Constraints
Hard rules that shape the build. List what matters for this specific project.

- {e.g., "UX lab — không real backend, mock JSON là đủ"}
- {e.g., "Không auth, không session"}
- {e.g., "Demo trên 1 laptop, không cần deploy"}
- {e.g., "User-facing strings Vietnamese có dấu"}

## API surface
Kinds of endpoints the frontend will need. Name the operation, not the URL. Claude Code
decides exact route shapes when building.

- {e.g., "chat send — student asks a question, gets back answer + topics + confidence"}
- {e.g., "list questions — teacher loads all flagged questions, filtered by topic"}
- {e.g., "flag answer — student marks an answer as wrong"}

## Success criteria
Observable checks. 3 bullets, each one a thing you could watch someone do.

- {e.g., "Student hỏi 3 câu liên tiếp không bị reload / mất history"}
- {e.g., "Teacher load trang thấy đúng danh sách câu được flag"}
- {e.g., "Đổi provider LLM = edit 1 file (src/llmService.js)"}

## Out of scope
Explicit. Prevents scope creep mid-build.

- {e.g., "Auth / login"}
- {e.g., "Persistent DB — chỉ mock JSON"}
- {e.g., "Mobile layout"}
- {e.g., "Dark mode, i18n, polish CSS"}

## Open questions
{Empty by default. Skill adds items only when it asked something during Step 2 that the
user didn't answer definitively. Example: "Teacher dashboard lọc theo ngày hay chỉ theo topic?"}
```

Fill from the conversation. Keep stories concrete — no "as a user, I want a great experience". Force role + action + outcome.

## Step 5 — Write GUIDELINE.md

Write to `<repo-root>/GUIDELINE.md`. Template:

```markdown
# GUIDELINE — {product name}

> Tech stack: see `PRD §Tech stack`.

## UI pattern
**{pattern number}. {pattern name}**

Why this pattern: {1–2 lines tying the user's answers to the pick}

{If pattern 1: add "Conversational UI + Evidence Panel" note with suggested panel payload —
e.g., "Panel = topic tags + AI self-reported confidence (0–100). NOT citations, NOT sources —
this app doesn't ground on a corpus, so honest labeling matters."}

## User flow (3 steps)
1. User {does input action}
2. App {AI processing step — be concrete about what the LLM sees}
3. User {interacts with output}

{If multiple roles: add a second flow block for the Demo 2 role.}

## T·C·R checklist for this pattern

### T — Transparency (what AI work is visible)
- [ ] {pattern-specific T item 1}
- [ ] {pattern-specific T item 2}
- [ ] {pattern-specific T item 3}

### C — Control (what user can stop / edit / override)
- [ ] {pattern-specific C item 1}
- [ ] {pattern-specific C item 2}
- [ ] {pattern-specific C item 3}

### R — Recovery (validation + retry + undo)
- [ ] {pattern-specific R item 1}
- [ ] {pattern-specific R item 2}
- [ ] {pattern-specific R item 3}

{If pattern 1 with topic list: add a fixed-list hint —
"Topic tagging dùng fixed list, không free-text. Danh sách: see PRD §Constraints or below."}

## Hinge rule
All LLM calls go through `src/llmService.js` (or equivalent named in `PRD §Tech stack`).
UI never imports a provider SDK directly. Swap providers = edit one file.

## What NOT to build yet
- {things that feel urgent but aren't — auth, persistent DB beyond mock, complex routing, dark mode, i18n, mobile layout, polish CSS}
- Demo cares about the core loop working end-to-end, not polish.
- T·C·R features come in a separate prompt (run `/tcr-apply` after baseline).
```

Fill the T·C·R checklist from the matrix below — **copy, don't invent**. Consistency across patterns is the whole point.

## Step 6 — Print the next-step prompt

Don't write to file. Print for the user to copy into Claude Code:

```
Read PRD.md and GUIDELINE.md in this directory completely before coding.

Build the Demo 1 scope stories from PRD.md (the ones tagged (Demo 1)).

Stack + constraints: use exactly what PRD §Tech stack and PRD §Constraints say.
Do not substitute libraries or add anything not listed.

- One screen / one surface only — no routing yet
- Implement the UI pattern named in GUIDELINE §UI pattern
- LLM calls go through src/llmService.js (the hinge — see GUIDELINE)
- For the backend, you decide route shapes from PRD §API surface. Mock data in JSON.
- User-facing strings in Vietnamese with dấu (unless PRD §Constraints says otherwise)
- Minimal CSS — readable, not polished

Do NOT add yet:
- T·C·R features from GUIDELINE (those come in separate prompts)
- Anything in PRD §Out of scope
- Other user stories from PRD — only the (Demo 1) ones

Run npm install + npm run dev when done. Show me the localhost URL.
```

Tell the user:

> Copy prompt trên, paste vào Claude Code ở repo root. Khi baseline chạy được, chạy `/tcr-apply` để thêm T·C·R. Sau đó dùng `/prd-to-screens` cho user story (Demo 2) trong PRD.

## T·C·R matrix by pattern

Use to fill the checklist in `GUIDELINE.md`. Identical to `/tcr-apply`'s matrix — do not drift.

### 1. Chat + context panel
- **T:** sources/topic panel (2–4 refs), streaming status line, confidence dot (green/yellow/red)
- **C:** stop button during streaming, edit-last-user-message, Cmd+K clear chat
- **R:** error bubble with retry + report, thumbs-down on each assistant message

### 2. Upload → dashboard
- **T:** parse/extract/analyze progress panel, per-insight source link back to file
- **C:** cancel during processing, preview modal before analyze if file is large
- **R:** pre-flight file validation (type/size/non-empty), "try different file", keep-previous-file undo

### 3. Query → structured result
- **T:** collapsible "view SQL/query" panel, confidence badge on result, meta line (rows/ms/model)
- **C:** edit generated query before run, confirm modal for destructive queries, Enter/Esc shortcuts
- **R:** retry on fail, "rephrase question" button that feeds error back to LLM, query history

### 4. Wizard + inline audit
- **T:** per-field audit (✓/⚠/✗) with 1-line reason, end-of-wizard summary card
- **C:** back/forward without data loss, save draft to localStorage, override AI warning
- **R:** validate per step, don't block on audit fail, preview + edit before final submit

### 5. Draft → approve → send
- **T:** confidence score per section, recipient/subject/attachment preview, generation meta log
- **C:** mandatory preview step (no generate-and-send), edit any field, save-as-draft option
- **R:** "sent · undo" toast with 10s window, sent log with retry, keep draft on send failure

### 6. Queue + approval
- **T:** confidence dot per item, 1-line AI reasoning, header counts (pending/auto-approvable/low-conf)
- **C:** bulk select + shift-click range, keyboard (J/K/A/R/U), filter by confidence threshold
- **R:** undo stack of 10, "flag for review" instead of reject, re-surface on data update

### 7. Real-time streaming
- **T:** live status ("listening/transcribing/analyzing"), token-by-token output, latency meta bar
- **C:** stop button aborts stream, pause/resume for transcription, Space/Esc shortcuts
- **R:** auto-reconnect (max 3), preserve transcript buffer on reconnect, manual restart button

## Anti-patterns — do NOT do these

- **Don't invent a stack.** If user didn't brief one, ask. Never guess "React + Next.js because it's popular".
- **Don't restate the stack in GUIDELINE.** GUIDELINE references `PRD §Tech stack`. One source of truth.
- **Don't run a rigid script.** Ask what's needed to remove uncertainty. If idea is clear, skip questions.
- **Don't pick 2 patterns.** Commit to one. "Hybrid" = confused students.
- **Don't write any code.** Only `PRD.md` + `GUIDELINE.md`. User runs the build prompt in Claude Code — that's the learning moment.
- **Don't design the backend in detail.** PRD sketches data model + API surface (operations, not URLs). Claude Code picks route shapes when building.
- **Don't add T·C·R features in the baseline build prompt.** Baseline = skeleton. T·C·R = separate prompts. Two phases, two commits.
- **Don't use English in user-facing strings** (if user-facing language is Vietnamese). Code identifiers stay English.
- **Don't invent a new pattern.** If nothing fits, default to 1 and adjust panel payload. The 7 cover >95% of ideas.
- **Don't skip the "Why this pattern" line.** Users who can explain the pick will pick correctly next time without this skill.

## Principles

- **Idea → short brainstorm → PRD + GUIDELINE → build prompt.** Four artifacts, one flow.
- **PRD owns product + stack. GUIDELINE owns UX.** Stack is a product decision (provider choice, mock vs real backend, language). UX is how users touch it. Don't mix them.
- **Skill records, doesn't invent.** User's stack goes in PRD verbatim. User's constraints go in PRD verbatim. Skill's job is structure + pattern pick, not tech opinion.
- **Skeleton before T·C·R.** Never bundle baseline build with T·C·R upgrades. Two phases, two prompts, two commits.
- **Vietnamese-first UX strings when the user is Vietnamese-speaking.** Code stays English.
- **Commit to the pick.** Ambiguous case → pattern 1 with adapted panel. Consistency beats perfection.
- **PRD is reused.** Demo 1 builds (Demo 1) stories. Demo 2 (via `/prd-to-screens`) picks (Demo 2) stories from the same PRD. Don't regenerate PRD per surface.

---

## Worked example — Ngữ văn 10 tutor

**User pastes:**

> "App giúp học sinh lớp 10 hỏi bài Ngữ văn — phân tích tác phẩm, giải thích nhân vật, luyện viết. Giáo viên xem được học sinh đang vướng chủ đề nào. Bối cảnh: đây là UX lab — không build real backend, mock JSON API là đủ. Stack định dùng: React 18 + Vite + plain JSX + inline styles + Express mock + Gemini 2.5 Flash qua src/llmService.js. Không TypeScript, không Tailwind, không SQLite."

**Skill's 3 clarifying questions:**

1. "Output của AI là text + topic tags (danh sách cố định, không phải citations từ corpus) + mức độ tin cậy AI tự đánh giá — đúng tinh thần không?" → user: đúng.
2. "2 role: student + teacher. Demo 1 = student chat, Demo 2 = teacher dashboard — đúng chưa?" → user: đúng.
3. "UI pattern mình chọn là **1. Chat + context panel** (Q+A text → text + topics + confidence). OK?" → user: OK.

**Skill writes PRD.md:**

```markdown
# PRD — Ngữ văn 10 Tutor

## Problem + context
Học sinh lớp 10 thường bí khi phân tích tác phẩm, giải thích nhân vật, luyện viết Ngữ văn. Giáo viên không scale được việc 1-1 giải đáp cho cả lớp. App này là UX lab build — kiểm chứng pattern chat+panel cho tutor AI, không production.

## Users
- **Primary:** Học sinh lớp 10 (hỏi bài Ngữ văn, đọc câu trả lời, đánh flag nếu thấy sai)
- **Secondary:** Giáo viên Ngữ văn (xem câu hỏi + câu được flag, lọc theo chủ đề)

## User stories
1. **(Demo 1)** Học sinh hỏi câu Ngữ văn, nhận câu trả lời + chủ đề liên quan + mức độ tin cậy AI tự đánh giá.
2. **(Demo 1)** Học sinh bấm "câu này chưa đúng" để báo flag cho giáo viên review sau.
3. **(Demo 2)** Giáo viên xem danh sách câu hỏi học sinh, lọc theo chủ đề và flag.
4. **(Demo 2)** Giáo viên click 1 câu để xem chi tiết câu hỏi + câu trả lời AI + lý do flag.

## Data model
- **questions** — id, student_id, text, created_at
- **answers** — id, question_id, text, topics (array), confidence (0–100), created_at
- **flags** — id, answer_id, reason, created_at

## Tech stack
- **Frontend:** React 18 + Vite + plain JSX + inline styles
- **Backend:** Express mock serving JSON
- **LLM:** Gemini 2.5 Flash qua `src/llmService.js`
- **Storage:** In-memory JSON, không DB
- **Not using:** TypeScript, Tailwind, SQLite

## Constraints
- UX lab build — không real backend, mock JSON là đủ
- Không auth, không session persistence
- Demo trên 1 laptop, không cần deploy
- User-facing strings Vietnamese có dấu
- Topic tagging dùng fixed list (xem dưới), không free-text

**Topic list (fixed):**
`["Thơ cách mạng", "Văn học dân gian", "Nghị luận xã hội", "Nhân vật và tác phẩm", "Thể loại và phong cách", "Ngữ pháp và viết"]`

## API surface
- **chat send** — student gửi câu hỏi → trả về answer text + topics (subset of fixed list) + confidence (0–100)
- **list questions** — teacher lấy danh sách questions, optional filter theo topic + flag status
- **get question detail** — teacher lấy 1 question + answer + flag (nếu có)
- **flag answer** — student báo 1 answer sai, kèm lý do

## Success criteria
- Học sinh hỏi 3 câu liên tiếp, app không mất history trong session
- Teacher load dashboard thấy đúng danh sách câu được flag, lọc được theo 6 topic
- Đổi provider LLM = edit 1 file (`src/llmService.js`), UI không đụng

## Out of scope
- Auth / login
- Persistent DB — chỉ mock JSON trong file
- Mobile layout
- Dark mode, i18n, polish CSS
- Citations từ corpus thật (topic tags = labels, không phải trích dẫn)

## Open questions
- (none)
```

**Skill writes GUIDELINE.md:**

```markdown
# GUIDELINE — Ngữ văn 10 Tutor

> Tech stack: see `PRD §Tech stack`.

## UI pattern
**1. Chat + context panel**

Why this pattern: input là câu hỏi text, output là text + metadata (topics, confidence). Q+A dạng text → pattern 1 mặc định.

**Conversational UI + Evidence Panel:** panel = **topic tags (from fixed list of 6) + AI self-reported confidence (0–100)**. NOT citations — app không grounding trên corpus thật, nên gọi là "topics" chứ không phải "sources". Honest labeling matters.

## User flow (Demo 1 — student)
1. Học sinh gõ câu hỏi Ngữ văn vào input ở nửa trái.
2. App gửi câu hỏi tới `src/llmService.js` → Gemini 2.5 Flash trả về `{text, topics[], confidence}`. Mock JSON lưu question + answer.
3. Học sinh đọc câu trả lời bên trái, thấy topic tags + confidence bên phải. Có thể bấm "câu này chưa đúng" để flag.

## User flow (Demo 2 — teacher)
1. Giáo viên mở dashboard, thấy danh sách câu hỏi học sinh (có filter theo topic + flag).
2. Giáo viên chọn filter → app lọc từ mock JSON → hiển thị list.
3. Giáo viên click 1 câu → panel detail hiện question + answer + lý do flag.

## T·C·R checklist for this pattern

### T — Transparency (what AI work is visible)
- [ ] Topic panel hiển thị 2–4 topic tags từ fixed list
- [ ] Streaming status line (ví dụ: "đang trả lời…")
- [ ] Confidence dot (green ≥70 / yellow 40–69 / red <40) cạnh mỗi câu trả lời

### C — Control (what user can stop / edit / override)
- [ ] Stop button khi AI đang stream
- [ ] Edit-last-user-message (chỉnh lại câu hỏi cuối, gửi lại)
- [ ] Cmd+K clear chat history trong session

### R — Recovery (validation + retry + undo)
- [ ] Error bubble với retry + report khi LLM fail
- [ ] Thumbs-down / "câu này chưa đúng" trên mỗi câu trả lời (chính là flag trong user story 2)

**Fixed topic list:**
`["Thơ cách mạng", "Văn học dân gian", "Nghị luận xã hội", "Nhân vật và tác phẩm", "Thể loại và phong cách", "Ngữ pháp và viết"]`

LLM được prompt trả về `topics: string[]` mà mỗi item phải nằm trong list này. Validate ở service layer, reject nếu AI trả topic lạ.

## Hinge rule
All LLM calls go through `src/llmService.js`. UI không bao giờ import Gemini SDK trực tiếp. Đổi provider (Gemini → Claude → GPT) = edit một file.

## What NOT to build yet
- Auth, login, student/teacher tài khoản riêng
- Persistent DB — chỉ mock JSON trong memory
- Mobile layout, responsive polish
- Dark mode, i18n, loading skeletons nhiều state
- Citations thật từ corpus — chỉ topic labels
- T·C·R features đầy đủ (chạy `/tcr-apply` sau khi baseline xong)
```

**Skill prints next-step prompt for user to paste into Claude Code:**

```
Read PRD.md and GUIDELINE.md in this directory completely before coding.

Build the Demo 1 scope stories from PRD.md (stories 1 and 2 — student chat + flag).

Stack + constraints: use exactly what PRD §Tech stack and PRD §Constraints say.
- React 18 + Vite + plain JSX + inline styles
- Express mock serving JSON
- Gemini 2.5 Flash via src/llmService.js
- No TypeScript, no Tailwind, no SQLite
- UX lab — mock JSON only, no real DB

- One screen / one surface only — no routing yet (student chat view only for Demo 1)
- Implement pattern 1 (Chat + context panel) from GUIDELINE §UI pattern
- Panel payload = topic tags (from fixed list of 6) + confidence (0–100)
- LLM calls go through src/llmService.js
- For backend, you decide route shapes from PRD §API surface. Mock JSON file for persistence.
- User-facing strings Vietnamese có dấu
- Minimal CSS — readable, not polished

Do NOT add yet:
- T·C·R features from GUIDELINE (those come in separate prompts)
- Teacher dashboard (that's Demo 2, separate surface)
- Anything in PRD §Out of scope (auth, persistent DB, mobile, dark mode, i18n)

Run npm install + npm run dev when done. Show me the localhost URL.
```

> Copy prompt trên, paste vào Claude Code ở repo root. Khi baseline student chat chạy, chạy `/tcr-apply` để thêm T·C·R. Sau đó dùng `/prd-to-screens` để build Demo 2 (teacher dashboard) từ cùng PRD này.
