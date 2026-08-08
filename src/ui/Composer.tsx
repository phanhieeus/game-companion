import { useState, type FormEvent } from "react";

interface Props {
  /** Đang chờ agent trả lời — chặn gửi tiếp để khỏi chồng hai lượt. */
  busy: boolean;
  listening: boolean;
  canSpeak: boolean;
  onSend: (text: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
}

const MIC_LABEL = {
  listening: "Đang nghe — nhả tay để dừng",
  ready: "Nhấn giữ để nói",
  unsupported: "Trình duyệt không hỗ trợ giọng nói",
};

/**
 * Ô nhập chữ + nút gửi + nút micro.
 *
 * Chữ và giọng nói đi CÙNG một đường `/agent` (xem `sendText`): quán ồn thì gõ,
 * tay bận chia bài thì nói, nhưng phía sau chỉ có một lối vào nên chốt xác nhận
 * và guardrail áp y hệt cho cả hai.
 *
 * Micro giữ kiểu NHẤN GIỮ: nhả tay là dừng, không bao giờ nghe lén.
 */
export function Composer({
  busy,
  listening,
  canSpeak,
  onSend,
  onStart,
  onEnd,
  onCancel,
}: Props) {
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText("");
    onSend(trimmed);
  };

  const micLabel = listening
    ? MIC_LABEL.listening
    : canSpeak
      ? MIC_LABEL.ready
      : MIC_LABEL.unsupported;

  return (
    <form className="composer" onSubmit={submit}>
      <input
        className="composer-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Gõ câu ở đây…"
        aria-label="Nhập câu cho trợ lý"
        enterKeyHint="send"
        autoComplete="off"
        disabled={busy}
      />

      <button
        type="button"
        className={`voice-button${listening ? " active" : ""}`}
        disabled={busy || !canSpeak}
        aria-label={micLabel}
        title={micLabel}
        // Nhấn giữ để nói, nhả tay là dừng — không nghe liên tục.
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onPointerLeave={() => listening && onCancel()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span aria-hidden="true">🎤</span>
      </button>

      <button
        type="submit"
        className="send-button"
        disabled={!text.trim() || busy}
        aria-label="Gửi"
      >
        <span aria-hidden="true">➤</span>
      </button>
    </form>
  );
}
