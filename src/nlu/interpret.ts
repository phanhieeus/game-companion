import type { Session } from "../domain/types";
import { computeScoreboard } from "../domain/scoring";
import type { Intent, InterpretContext } from "./types";

export function buildContext(
  session: Session,
  pendingQuestion?: string,
): InterpretContext {
  const scoreboard = computeScoreboard(session);
  return {
    players: session.players
      .filter((p) => p.status === "active")
      .map((p) => ({ id: p.id, name: p.name })),
    scoreboard: scoreboard.rows.map((r) => ({
      playerId: r.playerId,
      total: r.total,
    })),
    ...(session.mePlayerId ? { mePlayerId: session.mePlayerId } : {}),
    zeroSum: session.scoringConfig.zeroSum,
    roundsPlayed: scoreboard.roundsPlayed,
    ...(pendingQuestion ? { pendingQuestion } : {}),
  };
}

/**
 * Gọi proxy để suy intent. Lỗi mạng/quota trả về clarify thay vì ném ra —
 * một lượt hỏng phải để lại state y như trước khi nói (docs/product/voice-pipeline.md).
 */
/**
 * Lỗi hạ tầng KHÁC với intent.
 *
 * Trước đây lỗi mạng bị gói thành intent "clarify", nên app rơi vào trạng thái
 * "đang chờ bạn trả lời" sau khi rớt mạng — trong khi chẳng có câu hỏi nào.
 * Tách ra để UI xử lý đúng: lỗi thì báo lỗi và cho thử lại.
 */
export interface InterpretResult {
  intent: Intent | null;
  /** Có giá trị khi gọi hỏng — intent sẽ là null. */
  error: string | null;
  /** Thời gian chờ Gemini, hiện lên UI để người dùng biết chậm ở đâu. */
  ms: number;
  /** true khi lỗi là tạm thời (mạng, quota) — đáng để bấm "Thử lại". */
  retryable: boolean;
}

export async function interpret(
  transcript: string,
  context: InterpretContext,
): Promise<InterpretResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript, context }),
    });

    const data = (await response.json()) as Intent | { error: string };

    if ("error" in data) {
      return { intent: null, error: data.error, ms: elapsed(), retryable: true };
    }
    return { intent: data, error: null, ms: elapsed(), retryable: false };
  } catch {
    return {
      intent: null,
      error: "Không gọi được máy chủ. Kiểm tra kết nối rồi thử lại.",
      ms: elapsed(),
      retryable: true,
    };
  }
}
