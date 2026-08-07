/** Intent mà LLM suy ra — xem docs/product/conversation.md. */

export type Intent =
  | { intent: "record_round"; args: { entries: { player_id: string; delta: number }[] } }
  | { intent: "query_scoreboard"; args: Record<string, never> }
  | { intent: "query_player"; args: { player_id: string } }
  | { intent: "undo_round"; args: { sequence_no?: number } }
  | { intent: "query_history"; args: { limit?: number } }
  | { intent: "add_player"; args: { name: string } }
  | { intent: "end_session"; args: Record<string, never> }
  | { intent: "clarify"; args: { question: string } }
  | { intent: "unsupported"; args: { reply: string } };

export interface InterpretContext {
  players: { id: string; name: string }[];
  scoreboard: { playerId: string; total: number }[];
  mePlayerId?: string;
  zeroSum: boolean;
  roundsPlayed: number;
  /** Câu agent vừa hỏi, nếu lượt này là trả lời cho một câu clarify. */
  pendingQuestion?: string;
}
