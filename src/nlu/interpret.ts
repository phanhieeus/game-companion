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
export async function interpret(
  transcript: string,
  context: InterpretContext,
): Promise<Intent> {
  try {
    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript, context }),
    });

    const data = (await response.json()) as
      | Intent
      | { error: string };

    if ("error" in data) {
      return { intent: "clarify", args: { question: data.error } };
    }
    return data;
  } catch {
    return {
      intent: "clarify",
      args: { question: "Không gọi được máy chủ. Kiểm tra kết nối rồi thử lại." },
    };
  }
}
