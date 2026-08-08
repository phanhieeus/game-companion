/**
 * Mini-agent: các mảnh một agent cần có.
 *
 *   Tool     — việc agent làm được, bằng đúng những gì tay làm được
 *   ReAct    — vòng nghĩ → làm → nhìn kết quả → nghĩ tiếp
 *   HITL     — người chốt trước khi điểm vào sổ
 *   Memory   — nhớ trong lượt (hội thoại) và nhớ lâu (thói quen, biệt danh)
 *
 * Toàn bộ chạy ở SERVER (ADR 13): tool nằm cùng chỗ với dữ liệu phiên, nên
 * không phải đẩy state qua lại. Client chỉ gửi một câu nói và nhận kết quả.
 */

import type { ProposalRow, RoundOrder, Session } from "../../shared/types.ts";
import type { Tools } from "../tools/index.ts";

/** Một lượt trong hội thoại gửi cho model. */
export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "model"; text?: string; call?: ToolCall }
  | { role: "tool"; name: string; result: unknown };

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  /**
   * Chữ ký "suy nghĩ" Gemini gắn kèm mỗi lần gọi tool.
   *
   * Không dùng để làm gì cả — chỉ giữ hộ rồi trả lại nguyên vẹn ở lượt sau.
   * Thiếu nó thì Gemini 3.x từ chối cả request (400), tức là vòng ReAct chết
   * đúng ở bước thứ hai — xem Evidence của C-009.
   */
  thoughtSignature?: string;
}

/** Model trả về: gọi tool tiếp, câu trả lời, hay lỗi. */
export interface ModelReply {
  text?: string;
  call?: ToolCall;
  error?: string;
  retryable?: boolean;
}

/** Ngữ cảnh mà tool được chạy trong đó. */
export interface ToolContext {
  session: Session;
  tools: Tools;
  /**
   * Thứ tự bảng là tuỳ chọn HIỂN THỊ của client (ADR 5), server không giữ.
   * Tool chỉ ghi lại ý định; client đọc `uiIntents` trong response rồi tự áp.
   */
  ui: {
    setRoundOrder(order: RoundOrder): void;
  };
  memory: MemoryStore;
  /**
   * Gọi model — tiêm vào chứ không để vòng lặp tự đi gọi.
   *
   * Vòng lặp ReAct không cần biết Gemini tồn tại, càng không cần biết HTTP. Nhờ
   * vậy test chỉ đưa vào một hàm giả, không phải giả lập tầng mạng; và đổi nhà
   * cung cấp model sau này chỉ đụng `gemini.ts`.
   */
  model(messages: AgentMessage[]): Promise<ModelReply>;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema rút gọn theo dạng Gemini nhận. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Cần người xác nhận trước khi chạy.
   *
   * Khai báo ở TOOL chứ không để model tự quyết (ADR 12): model chỉ đề xuất,
   * code quyết định. Đổi prompt hay đổi model không được phép làm mất chốt này.
   */
  needsConfirm?: (args: Record<string, unknown>, ctx: ToolContext) => boolean;
  /** Câu đọc lên để xin xác nhận. */
  describe?: (args: Record<string, unknown>, ctx: ToolContext) => string;
  /**
   * Các dòng số hiện lên lúc xin xác nhận — T của T·C·R.
   *
   * Nghe "Hùng trừ một" giữa lúc ồn ào rất dễ trôi; nhìn thấy "Hùng −1" thì sai
   * là biết ngay. Khai ở TOOL cùng lý do với `needsConfirm` (ADR 12): để model
   * soạn câu hỏi thì đổi prompt là mất luôn con số người ta cần nhìn.
   *
   * `null` = không có gì để vẽ, UI lùi về câu chữ của `describe`.
   */
  propose?: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => ProposalRow[] | null;
  run(args: Record<string, unknown>, ctx: ToolContext): ToolResult;
}

export interface ToolResult {
  ok: boolean;
  /** Trả về cho model đọc ở bước tiếp theo. */
  data: unknown;
  /** Câu ngắn cho người dùng, nếu tool muốn nói gì đó ngay. */
  say?: string;
  /** Dữ liệu phiên đã đổi — UI phải vẽ lại. */
  changed?: boolean;
}

/* ── Memory ─────────────────────────────────────────────────────────── */

export interface MemoryFact {
  id: string;
  text: string;
  at: string;
}

export interface MemoryStore {
  /** Nhớ lâu: thói quen, biệt danh, luật nhà. Đưa vào system prompt. */
  facts(): MemoryFact[];
  remember(text: string): MemoryFact;
  forget(id: string): void;
  /** Nhớ trong lượt: hội thoại của phiên hiện tại. */
  turns(): AgentMessage[];
  appendTurn(message: AgentMessage): void;
  clearTurns(): void;
}

/* ── Kết quả một lượt agent ──────────────────────────────────────────── */

export type { ProposalRow, RoundOrder };

/**
 * Bản NỘI BỘ của kết quả — có thêm `call` mà client không bao giờ thấy.
 * Bản qua dây nằm ở `shared/types.ts`.
 */
export type AgentOutcome =
  /** Xong, đây là câu trả lời. */
  | { type: "final"; text: string }
  /** Cần người xác nhận trước khi chạy tool. */
  | { type: "confirm"; prompt: string; call: ToolCall; rows: ProposalRow[] | null }
  /** Hỏi lại vì thiếu thông tin. */
  | { type: "clarify"; question: string }
  | { type: "error"; message: string; retryable: boolean };
