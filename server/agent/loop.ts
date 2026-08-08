import type {
  AgentMessage,
  AgentOutcome,
  ModelReply,
  ProposalRow,
  ToolCall,
  ToolContext,
} from "./types.ts";
import { toolByName } from "./tools.ts";

/**
 * Trần cứng số bước ReAct (ADR 11).
 *
 * Mỗi bước là MỘT lượt gọi Gemini. Free tier có hạn và đã sập một lần rồi
 * (20 lượt/ngày trên model cũ). Vòng lặp không trần có thể đốt sạch quota chỉ
 * vì một câu nói làm model loanh quanh.
 */
const MAX_STEPS = 5;

export interface StepResult {
  outcome: AgentOutcome;
  /** Có tool nào đổi dữ liệu không — UI phải vẽ lại. */
  changed: boolean;
  /** Số lượt gọi Gemini đã dùng, để hiện lên cho người dùng biết. */
  steps: number;
}

async function callModel(
  messages: AgentMessage[],
  ctx: ToolContext,
): Promise<ModelReply> {
  try {
    return await ctx.model(messages);
  } catch {
    // Hàm model tự dịch lỗi của nó rồi; tới đây là hỏng ngoài dự tính.
    return { error: "Trợ lý đang trục trặc, thử lại giúp nhé.", retryable: true };
  }
}

/**
 * Chạy tool và ghi kết quả vào hội thoại.
 *
 * Kết quả tool được đưa NGƯỢC lại cho model ở bước sau — đó chính là chữ
 * "observe" trong ReAct. Nhờ vậy agent làm được việc nhiều bước: hỏi bảng điểm
 * rồi mới quyết ghi bao nhiêu, hoặc sửa xong rồi đọc lại xác nhận.
 */
function runTool(call: ToolCall, ctx: ToolContext) {
  const tool = toolByName.get(call.name);
  if (!tool) {
    return {
      result: { ok: false, data: { error: `Không có công cụ ${call.name}.` } },
      changed: false,
      say: undefined as string | undefined,
    };
  }
  const result = tool.run(call.args, ctx);
  return { result, changed: Boolean(result.changed), say: result.say };
}

/**
 * Tool này có cần người chốt trước khi chạy không (ADR 12).
 *
 * Trả về cả câu hỏi lẫn các dòng số để vẽ thẻ đề xuất — cả hai đều do TOOL khai,
 * không do model soạn.
 */
export function needsConfirm(
  call: ToolCall,
  ctx: ToolContext,
): { prompt: string; rows: ProposalRow[] | null } | null {
  const tool = toolByName.get(call.name);
  if (!tool?.needsConfirm?.(call.args, ctx)) return null;
  return {
    prompt: tool.describe?.(call.args, ctx) ?? `${call.name} nhé?`,
    rows: tool.propose?.(call.args, ctx) ?? null,
  };
}

/**
 * Một lượt agent: nghĩ → làm → nhìn kết quả → nghĩ tiếp, tối đa MAX_STEPS.
 *
 * Dừng khi model trả về câu chữ (xong), hoặc khi gặp tool cần người chốt —
 * lúc đó trả về "confirm" và nhường quyền cho người dùng. Bấm đồng ý thì gọi
 * `resume` để chạy tiếp từ đúng chỗ đó.
 */
export async function runAgent(
  userText: string,
  ctx: ToolContext,
): Promise<StepResult> {
  ctx.memory.appendTurn({ role: "user", text: userText });
  return loop(ctx, 0, false);
}

/** Chạy tiếp sau khi người dùng đã chốt một tool. */
export async function resumeAgent(
  call: ToolCall,
  accepted: boolean,
  ctx: ToolContext,
): Promise<StepResult> {
  if (!accepted) {
    ctx.memory.appendTurn({
      role: "tool",
      name: call.name,
      result: { ok: false, data: { error: "Người dùng từ chối." } },
    });
    return {
      outcome: { type: "final", text: "Được, bỏ qua." },
      changed: false,
      steps: 0,
    };
  }

  const { result, changed, say } = runTool(call, ctx);
  ctx.memory.appendTurn({ role: "tool", name: call.name, result: result.data });

  // Tool tự nói được thì khỏi tốn thêm một lượt gọi model chỉ để diễn đạt lại.
  if (say) return { outcome: { type: "final", text: say }, changed, steps: 0 };

  const next = await loop(ctx, 0, changed);
  return { ...next, changed: changed || next.changed };
}

async function loop(
  ctx: ToolContext,
  startStep: number,
  changedSoFar: boolean,
): Promise<StepResult> {
  let changed = changedSoFar;

  for (let step = startStep; step < MAX_STEPS; step += 1) {
    const reply = await callModel(ctx.memory.turns(), ctx);

    if (reply.error) {
      return {
        outcome: {
          type: "error",
          message: reply.error,
          retryable: reply.retryable ?? true,
        },
        changed,
        steps: step + 1,
      };
    }

    if (reply.call) {
      ctx.memory.appendTurn({ role: "model", call: reply.call });

      const confirm = needsConfirm(reply.call, ctx);
      if (confirm) {
        // Nhường quyền cho người. Vòng lặp dừng ở đây, không tự ý ghi.
        return {
          outcome: {
            type: "confirm",
            prompt: confirm.prompt,
            rows: confirm.rows,
            call: reply.call,
          },
          changed,
          steps: step + 1,
        };
      }

      const { result, changed: didChange, say } = runTool(reply.call, ctx);
      changed = changed || didChange;
      ctx.memory.appendTurn({
        role: "tool",
        name: reply.call.name,
        result: result.data,
      });

      if (say) {
        return { outcome: { type: "final", text: say }, changed, steps: step + 1 };
      }
      continue; // observe → nghĩ tiếp
    }

    const text = reply.text?.trim();
    if (text) {
      ctx.memory.appendTurn({ role: "model", text });
      return { outcome: { type: "final", text }, changed, steps: step + 1 };
    }

    return {
      outcome: {
        type: "clarify",
        question: "Mình chưa rõ ý, nói lại giúp nhé.",
      },
      changed,
      steps: step + 1,
    };
  }

  // Chạm trần: dừng và nói thật, đừng im lặng giả vờ xong.
  return {
    outcome: {
      type: "error",
      message:
        "Việc này nhiều bước quá, mình chưa làm xong. Thử tách thành từng câu ngắn hơn nhé.",
      retryable: false,
    },
    changed,
    steps: MAX_STEPS,
  };
}
