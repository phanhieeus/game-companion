---
name: tcr-apply
description: "Apply T-C-R pattern to an existing AI app UI. Detects archetype from code, generates 3 follow-up prompts (Transparency, Control, Recovery) tailored to what's already built. Use when student says 'thêm T-C-R', 'apply tcr', 'tcr apply', 'làm UX tốt hơn', 'retrofit ux pattern', 'upgrade chat to have sources panel', 'add transparency', 'add confidence score', 'show AI reasoning', 'add undo/retry', or anytime they want to layer T-C-R on a baseline app. Also trigger after a working MVP is demoed and student asks 'tiếp theo làm gì để UX tốt hơn'."
---

# TCR Apply — Retrofit T-C-R onto existing UI

Student already has a working baseline (chat UI, queue, form, dashboard — anything). This skill reads the code, guesses which of the 7 UX archetypes it matches, and hands back 3 copy-paste prompts — **Prompt T** (Transparency), **Prompt C** (Control), **Prompt R** (Recovery) — tailored to the code on disk.

The goal is not to rewrite the app. The goal is to layer T-C-R **additively** so students feel the pattern click.

## What this skill does

1. Reads the repo — finds the key UI file(s) and guesses the archetype
2. Generates 3 short, additive prompts (T, C, R) that the student pastes into Claude Code one at a time
3. Explains *why* each prompt was chosen for this archetype — so students build intuition

## When to use it

Student has a demo that runs. They say "bây giờ em muốn thêm T-C-R" / "UX còn thô, làm sao làm tốt hơn" / "retrofit theo pattern workshop". Run `/tcr-apply` from the repo root.

## T-C-R definitions (keep these exact — students memorize them)

- **T = Transparency.** Show the user what the AI is doing. Status lines ("Đang suy nghĩ...", "Đang tra cứu 3 nguồn..."), sources panel, confidence score with traffic-light colors (green >0.8, yellow 0.5–0.8, red <0.5), visible SQL/reasoning/plan, token usage, which model.
- **C = Control.** User can stop, edit, override *before* the AI acts irreversibly. Abort button, edit-before-execute, pin/clear, bulk shortcuts for queues, keyboard shortcuts, "dry run" preview.
- **R = Recovery.** Pre-flight validation + post-hoc retry. Check input before the LLM call, retry button on error, undo last action, "flag as bad" button (becomes training signal), regenerate, preview + cancel before send.

If a prompt you generate doesn't obviously map to one of T / C / R, rewrite it until it does. The three letters are the load-bearing frame.

## Step 1: Detect the archetype

Read the repo. Look for the main UI file — usually in `src/`, `app/`, `streamlit_app.py`, `pages/`, or `components/`. Then match against this table. First strong signal wins; if ambiguous, pick the closest and note the alternative in the output.

| Archetype | Signals in code | Typical files |
|---|---|---|
| 1. Chat + context panel | `message`, `chat`, `thread`, `useChat`, `role: "user"`, `role: "assistant"`, `st.chat_message` | `chat.tsx`, `Chat.jsx`, `streamlit_app.py` with `st.chat_input` |
| 2. Upload → dashboard | `upload`, `fileInput`, `FormData`, `multer`, `st.file_uploader`, PDF/CSV parsing | `upload.py`, `dashboard.tsx`, ingestion code |
| 3. Query → structured result | `query`, `sql`, `runQuery`, chart/table render, `st.dataframe`, `recharts` | `query.tsx`, `sql_agent.py` |
| 4. Wizard + inline audit | Multi-step form, step indicator, `currentStep`, `wizard`, `stepper` | `Wizard.tsx`, `form-steps/` |
| 5. Draft → approve → send | `send`, `approve`, `confirm` + destination (email/SMS/API/webhook), `sendEmail`, `POST /send` | `compose.tsx`, `outbox.py` |
| 6. Queue + approval | Array of items + approve/reject buttons, bulk selection, `pending`, `review_queue` | `queue.tsx`, `review-list.tsx` |
| 7. Real-time streaming | `stream`, `eventsource`, `SSE`, `audio`, `transcription`, `on_chunk`, `ReadableStream` | `stream.ts`, `live.tsx` |

Fallback: if nothing matches, print the 7 names and ask: "Mình không tự detect được — cái nào giống app của em nhất?"

### Pattern transfers wider (important insight from workshop)

Chat + context panel is secretly **"Conversational UI + Evidence Panel."** Rename the panel payload and it covers 5 archetypes:

- panel = **sources** → RAG chatbot
- panel = **progress** → long-running agent
- panel = **reasoning** → research / planning agent
- panel = **chart** → data Q&A
- panel = **queue** → inbox / approval

When the detected archetype is Chat + panel, always add this note to the output:

> Your baseline is also adaptable to: sources-panel (RAG), progress-panel (agent), reasoning-panel (research), chart-panel (data Q&A), queue-panel (inbox). Same shell, swap the panel payload.

This saves students from thinking each archetype needs a new app.

## Step 2: Generate the 3 prompts

The archetype determines which prompts to emit. Keep each prompt **≤80 words**, **additive** (don't touch file structure), and **Vietnamese-friendly** for user-facing strings.

### Archetype 1 — Chat + context panel (fullest version)

**Prompt T (Transparency):**
> Trong file chat UI, thêm một panel bên phải tên "Nguồn tham khảo". Mỗi khi assistant trả lời, render ra 2–4 source cards (title, snippet, link). Thêm status line trên input box: "Đang suy nghĩ..." khi streaming, "Đã trả lời dựa trên N nguồn" khi xong. Nếu response có confidence score, show dot màu: xanh >0.8, vàng 0.5–0.8, đỏ <0.5. Không refactor code hiện có.

*Why:* Chat UI hides the AI's work. Sources + status + confidence dot make the reasoning visible without user having to ask. Traffic-light colors scale to non-technical users.

**Prompt C (Control):**
> Thêm nút "Dừng" (Stop) cạnh send button, chỉ hiện khi đang streaming — click thì abort fetch/stream. Thêm nút "Sửa lại câu hỏi" (Edit) trên message cuối của user — click thì copy nội dung vào input box và xoá message cũ + reply tương ứng. Giữ keyboard shortcut: Cmd/Ctrl+K = clear chat. Additive only.

*Why:* Users need an escape hatch mid-stream (long answer going wrong direction) and a way to refine a question without retyping. Edit-before-resend is the highest-leverage Control move for chat.

**Prompt R (Recovery):**
> Khi LLM call fail hoặc timeout, hiện error bubble đỏ với 2 nút: "Thử lại" (retry same prompt) và "Báo lỗi" (sends the message + error to a `/feedback` endpoint — tạo mới nếu chưa có, in-memory array OK). Thêm nút 👎 dưới mỗi assistant message — click thì POST vào `/feedback` với message id và label "bad". Không thay đổi success path.

*Why:* Errors are where trust breaks. Retry removes friction; thumbs-down turns every bad answer into a training signal. Cheap to add, compounds over time.

### Archetype 2 — Upload → dashboard

**Prompt T:**
> Sau khi upload file, hiện progress panel với các bước: "Đang parse", "Đang extract", "Đang phân tích", "Hoàn tất" — check mark từng bước khi xong. Ở dashboard, với mỗi metric/insight AI tạo ra, thêm small "ⓘ Nguồn" — hover/click show dòng nào trong file nó lấy ra. Không refactor parser.

*Why:* Upload flows feel like a black box. A visible pipeline + per-insight source link turns the dashboard from "trust me bro" into "tôi thấy nó lấy từ đâu".

**Prompt C:**
> Trong lúc đang process, show nút "Huỷ" — abort the fetch + clear state. Trước khi chạy phân tích, nếu file >5MB hoặc >500 rows, hiện preview modal: "File có N rows, ~X tokens, ước tính Y VND. Tiếp tục?" với Confirm / Cancel. Additive.

*Why:* Long-running + expensive = user needs kill switch and cost preview. Preview-before-execute is the Control pattern that prevents surprise bills.

**Prompt R:**
> Validate file trước khi gửi lên LLM: check extension, size <20MB, non-empty. Nếu fail, show inline error với lý do cụ thể. Sau khi parse xong, nếu zero rows hoặc parse error, show "Thử lại với file khác" + "Báo lỗi định dạng này". Thêm undo: giữ lại file vừa upload 1 lần trước, nút "Quay lại file cũ".

*Why:* Garbage-in is the #1 failure mode for upload apps. Pre-flight validation + undo lets students recover without re-uploading.

### Archetype 3 — Query → structured result

**Prompt T:**
> Mỗi khi user hỏi, show generated SQL (hoặc query plan) trong collapsible panel "Xem truy vấn". Trên kết quả, thêm badge confidence: xanh/vàng/đỏ + tooltip giải thích. Thêm dòng meta: "N rows · X ms · model: claude-sonnet". Nếu chart render, show nút "Xem data thô" → table view.

*Why:* Query apps fail silently when SQL is wrong. Showing the query lets power users catch hallucinations; confidence + row count lets everyone else sanity-check.

**Prompt C:**
> Nút "Sửa SQL" cho user edit generated query rồi re-run. Trước khi chạy, nếu query có `DELETE/UPDATE/DROP`, hiện confirm modal. Keyboard: Enter = run, Esc = clear. Additive.

*Why:* Generated SQL needs an edit loop — 80% right is common, auto-run is dangerous for destructive queries.

**Prompt R:**
> Nếu query fail (syntax, timeout, empty result), show error card với: error text, nút "Thử lại", nút "Gợi ý lại" (re-prompt LLM with error as context). Keep query history — nút "Quay lại câu trước".

*Why:* Query iteration is the core loop. Giving the LLM its own error message as recovery context is a pattern students will reuse everywhere.

### Archetype 4 — Wizard + inline audit

**Prompt T:**
> Bên cạnh từng step, hiện "AI đang check" indicator. Khi user fill field, show inline audit: ✓ hợp lệ / ⚠ cần xem lại / ✗ có vấn đề — kèm 1 dòng giải thích. Cuối wizard show summary card: tất cả fields + AI assessment per section.

*Why:* Wizards feel long; inline audit gives instant feedback so users don't submit then find out it's wrong.

**Prompt C:**
> Cho phép back/forward giữa các step không reset data. Thêm "Save draft" button — lưu localStorage, reload thì restore. Allow overriding AI warning: "Tôi biết, vẫn tiếp tục".

*Why:* Multi-step forms lose data constantly. Draft save + override ack respects user autonomy (AI gives advice, human decides).

**Prompt R:**
> Validate mỗi step trước khi next. Nếu AI audit fail, không block — chỉ warn. Cuối flow trước submit, show full preview + "Chỉnh sửa" nút về từng section. Submit fail thì giữ nguyên data, không reset wizard.

*Why:* Losing 5 steps of input to one network error breaks trust forever.

### Archetype 5 — Draft → approve → send

**Prompt T:**
> Trong draft view, show confidence score của AI cho từng section. Show "Đã reference N emails/docs trước" (nếu có context). Trước khi send, show meta panel: recipient, subject, attachments count, est. delivery time. Log: "Generated by model X, edited Y times by user".

*Why:* Send actions are irreversible in users' minds (even if technically undoable). Transparency before send = confidence before click.

**Prompt C:**
> Bắt buộc preview step trước khi send — không cho "generate & send" 1 click. Cho edit mọi field trong preview. Nút "Lưu draft thay vì gửi". Keyboard: Cmd+Enter = send, Esc = back to edit.

*Why:* The #1 AI send-app failure is auto-send with wrong recipient/content. Forced preview is non-negotiable.

**Prompt R:**
> Sau khi send, hiện toast "Đã gửi · Hoàn tác" với 10 giây window để unsend (delete + recover draft). Log tất cả sends vào table "Đã gửi" với retry button. Nếu send fail, keep draft nguyên vẹn, show error.

*Why:* Gmail-style undo-send trains the user to trust the system. No undo = user second-guesses every click.

### Archetype 6 — Queue + approval

**Prompt T:**
> Mỗi item trong queue show: confidence dot (xanh/vàng/đỏ), 1-line AI reasoning ("Tại sao đề xuất approve/reject"), source reference nếu có. Top of queue show counts: "N chờ duyệt · M high-confidence auto-approvable · K low-confidence".

*Why:* Queues scale when reviewers can triage by confidence. High-conf batch through fast, low-conf get human attention.

**Prompt C:**
> Thêm bulk select (checkbox + shift-click range) và nút "Approve tất cả selected". Keyboard: J/K = next/prev, A = approve, R = reject, U = undo last action. Filter: "Chỉ show confidence <0.7" để reviewer focus việc khó.

*Why:* A queue without keyboard + bulk is unusable at scale. This is where Control compounds — 10x faster review.

**Prompt R:**
> Undo last N actions (stack of 10). Nếu approve nhầm, nút "Hoàn tác" revert. "Flag for review" thay vì reject — sends item + reason to a review log. Nếu AI confidence thay đổi sau khi data update, re-surface items.

*Why:* Reviewer fatigue = misclicks. Undo + flag-instead-of-reject gives a safe middle path.

### Archetype 7 — Real-time streaming

**Prompt T:**
> Show live status: "Đang nghe...", "Đang transcribe... (N giây)", "Đang phân tích...". Stream partial output vào UI as it arrives (token-by-token). Show running confidence if available. Meta bar: "Model X · latency Y ms · chunk Z".

*Why:* Silence in a streaming app = broken app. Token-by-token + status keeps the user oriented.

**Prompt C:**
> Nút "Dừng nghe" / "Dừng stream" — abort fetch/WebSocket. Cho pause + resume nếu transcription. Keyboard: Space = pause/resume, Esc = stop.

*Why:* Real-time flows need instant stop. Users panic when they can't kill an open mic.

**Prompt R:**
> Nếu stream disconnect, auto-reconnect tối đa 3 lần, show "Mất kết nối · Đang thử lại (N/3)". Giữ transcript buffer — reconnect thì tiếp tục append, không reset. Nút "Bắt đầu lại" clear + restart.

*Why:* Network hiccups are constant. Silent reconnect + preserved buffer = student looks like they shipped a pro app.

## Step 3: Output format

Print this, nothing else:

```
━━━ TCR Apply — Archetype detected: {archetype name} ━━━

Evidence: {1-2 lines of what files/patterns led to this guess}

{If archetype 1, include the "Pattern transfers wider" note here}

━━━ Prompt T (Transparency) ━━━
{prompt text in a code block the student copies}

Why: {1-2 sentences}

━━━ Prompt C (Control) ━━━
{prompt text in a code block}

Why: {1-2 sentences}

━━━ Prompt R (Recovery) ━━━
{prompt text in a code block}

Why: {1-2 sentences}

━━━ How to use ━━━
Paste 1 prompt at a time into Claude Code. After each one: review the diff, test in browser, commit. Then paste the next. Don't paste all 3 at once — T-C-R compound when added in sequence.
```

## Anti-patterns — do NOT do these

- **Don't rewrite from scratch.** Every prompt must be additive. If your prompt says "refactor" or "restructure", delete it.
- **Don't change file structure.** Student's folder layout is theirs. Add new components, don't move old ones.
- **Don't bundle T+C+R into one prompt.** The whole point is sequential paste-review-commit. A mega-prompt loses the pedagogical rhythm.
- **Don't use English for user-facing strings.** Status lines, buttons, errors → Vietnamese with dấu. Code identifiers stay English.
- **Don't prescribe the exact component library.** If student uses shadcn, let them; if raw Tailwind, let them. Prompts say *what*, not *which npm package*.
- **Don't skip the "Why".** A prompt without reasoning is a recipe. The workshop teaches the *pattern* — reasoning is the whole point.
- **Don't guess the archetype silently.** If signals are weak, say so and ask. Wrong archetype = wrong prompts = wasted student time.
- **Don't add Control/Recovery features that require backend changes the student hasn't built.** If there's no `/feedback` endpoint, note "tạo mới nếu chưa có, in-memory array OK" — keep it frontend-friendly.

## Principles

- **Additive, not transformative.** Student leaves with the same app + 3 focused upgrades, not a new app.
- **One archetype, 3 prompts.** Don't generate 7 prompts hedging across archetypes. Pick one, commit.
- **Intuition over recipe.** Every "Why" builds the mental model of T-C-R so the student applies it to the next app without this skill.
- **Copy-paste ready.** If the student has to edit your prompt before pasting, you failed.
- **Vietnamese-first UX strings.** These students build for Vietnamese users. Default to Vietnamese with dấu.
