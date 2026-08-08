/**
 * Nói chuyện với Gemini — chỗ DUY NHẤT trong hệ thống biết Gemini tồn tại.
 *
 * Tách riêng khỏi vòng lặp ReAct (`agent/loop.ts`) để vòng lặp không biết gì về
 * HTTP hay hình dạng request của một nhà cung cấp cụ thể. Nhờ vậy test vòng lặp
 * chỉ cần đưa vào một hàm model giả, không phải giả lập tầng mạng.
 *
 * API key nằm ở đây và không bao giờ xuống trình duyệt (decision 0002).
 */

import type { AgentMessage } from "./agent/types.ts";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
/**
 * Đổi được để e2e trỏ sang Gemini giả (xem e2e/fakeGeminiServer.ts).
 *
 * Nhờ vậy test chạy đúng code thật của server — HTTP, tool layer, chốt HITL,
 * lưu đĩa — chỉ có phần "model nghĩ gì" là giả. Mock ở tầng trình duyệt sẽ
 * chặn mất chính những thứ cần kiểm.
 */
const BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

export const hasApiKey = (): boolean => Boolean(API_KEY);
export const modelName = (): string => MODEL;

/** Ngữ cảnh phiên nhét vào system prompt. */
export interface PromptContext {
  players: { name: string }[];
  mePlayer?: string | undefined;
  zeroSum: boolean;
  roundsPlayed: number;
  confirmBeforeCommit: boolean;
  memory: string[];
}

export interface ModelReply {
  text?: string;
  call?: { name: string; args: Record<string, unknown>; thoughtSignature?: string };
  error?: string;
  retryable?: boolean;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: unknown;
}

function agentSystemPrompt(context: PromptContext): string {
  const {
    players = [],
    mePlayer,
    zeroSum,
    roundsPlayed = 0,
    confirmBeforeCommit,
    memory = [],
  } = context ?? {};

  const roster = players.map((p) => `- ${p.name}`).join("\n");

  return `Bạn là trợ lý ghi điểm bài, điều khiển hoàn toàn bằng giọng nói tiếng Việt.
Bạn LÀM ĐƯỢC mọi việc mà người dùng làm được bằng tay: ghi ván, sửa ván, xóa ván,
hoàn tác, làm lại, thêm/bớt người chơi, đổi thứ tự bảng, xem điểm, và ghi nhớ.

Người chơi (đã chơi ${roundsPlayed} ván):
${roster}
${mePlayer ? `Người đang cầm máy là ${mePlayer} — "tôi/mình/tao" nghĩa là người này.` : ""}

${memory.length ? `Những điều bạn đã nhớ về nhóm này:\n${memory.map((m) => `- ${m}`).join("\n")}\n` : ""}
Cách làm việc:
- Bạn được gọi nhiều lượt. Mỗi lượt: gọi MỘT công cụ, hoặc trả lời bằng chữ khi đã xong.
- Kết quả công cụ sẽ được đưa lại cho bạn ở lượt sau. Dùng nó để quyết bước tiếp.
- Cần biết điểm hiện tại trước khi quyết? Gọi get_scoreboard hoặc get_history trước.
- Khi đã làm xong việc, trả lời bằng MỘT CÂU NGẮN tiếng Việt, đọc lên nghe được.
- Đừng gọi công cụ chỉ để nói lại điều vừa làm — trả lời thẳng bằng chữ.

Hiểu tiếng Việt:
- "ăn", "thắng", "được" = điểm dương. "chung", "thua", "đền", "mất" = điểm âm.
- "ba người kia", "mấy người còn lại", "cả làng" = những người không được nhắc tên.
- Tên nghe được có thể sai chính tả do nhận dạng giọng nói; khớp gần đúng là được.
${
  zeroSum
    ? `
QUAN TRỌNG — tổng điểm mỗi ván phải bằng 0:
- Nếu người nói ĐÃ cho biết cách chia thì tính ra rồi gọi record_round luôn.
  "Nam ăn 3, ba người kia mỗi người chung 1" → Nam +3, ba người còn lại mỗi người -1.
- Nếu CHƯA biết ai chung thì hỏi lại bằng chữ, đừng tự bịa.
- Cộng lại phải đúng 0 mới được gọi record_round.`
    : ""
}
${
  confirmBeforeCommit
    ? `
App tự hỏi xác nhận trước khi ghi — bạn KHÔNG cần hỏi "đúng không?" cho điều mình
đã hiểu rõ. Cứ gọi công cụ, app lo phần chốt.`
    : ""
}
Chỉ trả lời bằng tiếng Việt có dấu.`;
}

/**
 * Hội thoại nội bộ → định dạng contents của Gemini.
 *
 * `thoughtSignature` phải được trả lại NGUYÊN VẸN kèm functionCall ở các lượt
 * sau. Gemini 3.x từ chối cả request với 400 nếu thiếu — vòng ReAct gãy ngay ở
 * bước thứ hai, đúng bước làm nên chữ "observe". Từ ADR 13 thì hội thoại nằm ở
 * server nên chữ ký cũng ở đây, không phải gửi qua lại nữa.
 */
function toGeminiContents(messages: AgentMessage[]) {
  const contents: unknown[] = [];
  for (const m of messages ?? []) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "model") {
      contents.push({
        role: "model",
        parts: m.call
          ? [
              {
                functionCall: { name: m.call.name, args: m.call.args ?? {} },
                ...(m.call.thoughtSignature
                  ? { thoughtSignature: m.call.thoughtSignature }
                  : {}),
              },
            ]
          : [{ text: m.text ?? "" }],
      });
    } else if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name,
              response: { result: m.result ?? null },
            },
          },
        ],
      });
    }
  }
  return contents;
}


/**
 * Một lượt gọi model: hội thoại vào, "gọi tool tiếp" hoặc "câu trả lời" ra.
 *
 * Lỗi được dịch thành câu người đọc được kèm cờ `retryable`, vì hai loại 429
 * của Gemini có cách xử lý khác hẳn nhau: hết quota NGÀY thì mai mới dùng tiếp
 * được (nói lại vô ích), còn quá giới hạn PHÚT thì chờ chút là xong.
 */
export async function callGemini(
  messages: AgentMessage[],
  tools: ToolDeclaration[],
  context: PromptContext,
): Promise<ModelReply> {
  if (!API_KEY) {
    return {
      error: "Thiếu GEMINI_API_KEY. Xem .env.example.",
      retryable: false,
    };
  }

  const body = {
    system_instruction: { parts: [{ text: agentSystemPrompt(context) }] },
    contents: toGeminiContents(messages),
    tools: [{ function_declarations: tools }],
    // AUTO chứ không ANY: agent phải được phép TRẢ LỜI BẰNG CHỮ khi đã xong,
    // nếu ép luôn gọi tool thì vòng lặp không bao giờ kết thúc.
    tool_config: { function_calling_config: { mode: "AUTO" } },
    generationConfig: { temperature: 0 },
  };

  try {
    const response = await fetch(
      `${BASE_URL}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(`Gemini ${response.status}:`, detail);
      if (response.status === 429) {
        const perDay = /PerDay|per_day/i.test(detail);
        return perDay
          ? {
              error:
                "Hết quota Gemini hôm nay. Mai dùng tiếp, hoặc nhập điểm bằng tay.",
              retryable: false,
            }
          : {
              error:
                "Nói hơi nhanh, Gemini đang giới hạn theo phút. Chờ một chút rồi nói lại.",
              retryable: true,
            };
      }
      return { error: `Gemini trả lỗi ${response.status}.`, retryable: true };
    }

    const data = (await response.json()) as {
      candidates?: {
        content?: {
          parts?: {
            text?: string;
            functionCall?: { name: string; args?: Record<string, unknown> };
            thoughtSignature?: string;
          }[];
        };
      }[];
    };

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const callPart = parts.find((p) => p.functionCall);
    if (callPart?.functionCall) {
      return {
        call: {
          name: callPart.functionCall.name,
          args: callPart.functionCall.args ?? {},
          ...(callPart.thoughtSignature
            ? { thoughtSignature: callPart.thoughtSignature }
            : {}),
        },
      };
    }
    return { text: parts.find((p) => p.text)?.text ?? "" };
  } catch (error) {
    console.error("gemini failed:", error);
    return { error: "Không gọi được Gemini.", retryable: true };
  }
}
