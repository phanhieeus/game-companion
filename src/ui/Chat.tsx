import { useEffect, useRef } from "react";
import type { Bubble, VoiceState } from "../conversation/useConversation";
import type { ProposalRow } from "../api/model";
import { ProposalCard } from "./ProposalCard";

interface Props {
  messages: Bubble[];
  state: VoiceState;
  /** Câu đang nghe dở — chưa chốt nên chưa vào mạch hội thoại. */
  transcript: string;
  pendingPrompt: string | null;
  proposal: ProposalRow[] | null;
  canRetry: boolean;
  onRetry: () => void;
  onAccept: () => void;
  onReject: () => void;
}

/** Câu cuối của một đoạn — phần hỏi, bỏ phần liệt kê số ở trước. */
function lastSentence(text: string | null): string | null {
  if (!text) return null;
  const parts = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  return parts.at(-1) ?? text;
}

/**
 * Mạch hội thoại — bong bóng người dùng và bong bóng trợ lý, cuộn được.
 *
 * Trước C-024 khu này chỉ hiện CÂU CUỐI. Nói vài lượt rồi thì không còn cách nào
 * kiểm lại agent đã hiểu gì ở lượt trước, trong khi đó đúng là thứ cần soát nhất
 * khi số đã vào sổ. Giữ cả mạch thì sai ở đâu lần ngược được tới đó.
 *
 * Thẻ đề xuất nằm TRONG mạch chứ không nổi đè lên đáy màn hình: nó là một lượt
 * của cuộc nói chuyện, và để trong mạch thì nó không che mất câu vừa nói.
 */
export function Chat({
  messages,
  state,
  transcript,
  pendingPrompt,
  proposal,
  canRetry,
  onRetry,
  onAccept,
  onReject,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);

  // Lượt mới luôn phải nằm trong tầm mắt — khung có chiều cao hữu hạn nên không
  // tự cuộn thì câu trả lời mới rơi xuống dưới mép, người dùng tưởng agent câm.
  //
  // Nhưng cuộn xuống ĐÁY chỉ đúng khi khối cuối thấp hơn khung. Thẻ đề xuất bốn
  // người thì CAO HƠN, và cuộn đáy cắt mất phần trên của nó — trên production
  // đã thấy tận mắt: dòng "Lan +2", đúng con số lớn nhất, nằm ngoài mép trên,
  // người dùng bấm Ghi mà chưa từng nhìn thấy nó. Thứ đang chờ quyết định phải
  // đọc được TỪ ĐẦU, nên nó neo mép TRÊN; còn lại mới neo mép dưới.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ask = askRef.current;
    if (!ask) {
      box.scrollTop = box.scrollHeight;
      return;
    }
    box.scrollTop +=
      ask.getBoundingClientRect().top - box.getBoundingClientRect().top;
  }, [messages.length, state, transcript, proposal, pendingPrompt]);

  const empty = messages.length === 0 && !transcript;

  return (
    <div className="chat" ref={boxRef} role="log" aria-label="Hội thoại">
      {empty && (
        <p className="hint">
          Nhấn giữ nút micro rồi nói, hoặc gõ thẳng vào ô bên dưới — ví dụ “Nam
          ăn 3, ba người kia mỗi người chung 1”.
        </p>
      )}

      {messages.map((m) => (
        <div
          key={m.id}
          className={`bubble ${m.who}${m.failed ? " error" : ""}`}
        >
          {m.text}
        </div>
      ))}

      {/* Câu đang nghe dở: vẽ mờ hơn để phân biệt với câu đã gửi đi. */}
      {transcript && <div className="bubble you live">{transcript}</div>}

      {state === "understanding" && (
        <div className="bubble agent thinking" aria-label="Đang nghĩ">
          <span />
          <span />
          <span />
        </div>
      )}

      {state === "confirming" && (
        <div className="ask" ref={askRef}>
          {proposal ? (
            <ProposalCard
              rows={proposal}
              /* Câu của tool ("Lan +4, Hùng −1… Ghi ván này nhé?") viết ra để
                 ĐỌC LÊN — nghe thì cần con số. Trên màn hình các dòng bên dưới
                 đã có đủ, nhắc lại thành chữ chỉ làm rối chỗ cần liếc nhất. */
              title={lastSentence(pendingPrompt) ?? "Ghi ván này nhé?"}
              onAccept={onAccept}
              onReject={onReject}
            />
          ) : (
            /* Tool không có con số nào để vẽ ("kết thúc phiên nhé?") — vẫn phải
               có hai nút, nếu không người dùng kẹt ở trạng thái chờ chốt. */
            <div className="proposal" role="group" aria-label="Xác nhận">
              <div className="proposal-head">{pendingPrompt}</div>
              <div className="confirm-bar">
                <button type="button" className="yes" onClick={onAccept}>
                  Đồng ý
                </button>
                <button type="button" className="no" onClick={onReject}>
                  Bỏ qua
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* R — chạy lại đúng câu vừa nói, không bắt nói lại. */}
      {canRetry && (
        <button type="button" className="retry" onClick={onRetry}>
          ↻ Thử lại câu vừa nói
        </button>
      )}
    </div>
  );
}
