import type { Page } from "@playwright/test";

/**
 * Điều khiển Gemini giả (`e2e/fakeGeminiServer.ts`) và dọn dữ liệu giữa các test.
 *
 * Khác hẳn bản trước ADR 13: hồi đó mock `/api/*` ngay trong trình duyệt, vì
 * tool layer chạy ở client. Giờ mọi thứ nằm ở server nên mock như vậy sẽ chặn
 * mất chính cái cần kiểm. Ta chỉ giả ĐÚNG MỘT THỨ không kiểm soát được — model.
 */

const GEMINI = "http://localhost:8799";
const API = "http://localhost:8788";

export interface AgentReply {
  text?: string;
  call?: { name: string; args?: Record<string, unknown> };
}

/**
 * Kịch bản: câu người dùng nói → các lượt trả lời liên tiếp cho câu đó.
 *
 * Một lượt nói có thể gọi model nhiều lần (mỗi bước ReAct một lần), nên giá trị
 * là MẢNG: phần tử 0 cho bước đầu, 1 cho bước sau… Ví dụ ghi ván thường là
 * `[gọi record_round, "Xong."]` — bước sau cần thiết vì sau khi người dùng bấm
 * Ghi, server chạy tool rồi hỏi model lần nữa để lấy câu nói.
 */
export async function scriptAgent(
  page: Page,
  script: Record<string, AgentReply[]>,
  options: { failures?: number } = {},
): Promise<void> {
  const response = await page.request.post(`${GEMINI}/__script`, {
    data: { script, failures: options.failures ?? 0 },
  });
  if (!response.ok()) throw new Error("không đặt được kịch bản cho Gemini giả");
}

/**
 * Xoá sạch phiên trên server.
 *
 * Dữ liệu không còn nằm trong localStorage nên `context.clearCookies()` hay
 * xoá storage đều vô nghĩa — phải nói với server.
 */
export async function resetServer(page: Page): Promise<void> {
  const response = await page.request.post(`${API}/api/test/reset`);
  if (!response.ok()) throw new Error("không reset được server");
}

/** Ván bốn người quen thuộc: Nam ăn 3, ba người kia mỗi người chung 1. */
export const NAM_AN_3: AgentReply = {
  call: {
    name: "record_round",
    args: {
      entries: [
        { player: "Nam", delta: 3 },
        { player: "Hùng", delta: -1 },
        { player: "Lan", delta: -1 },
        { player: "Tú", delta: -1 },
      ],
    },
  },
};

/** Một lượt ghi ván: gọi tool ở bước đầu, nói một câu ở bước sau. */
export const recordThenSay = (
  round: AgentReply,
  say = "Xong nhé.",
): AgentReply[] => [round, { text: say }];

/** Ghi ván cho theo tên, đỡ phải viết `entries` dài dòng. */
export const record = (...deltas: [string, number][]): AgentReply => ({
  call: {
    name: "record_round",
    args: {
      entries: deltas.map(([player, delta]) => ({ player, delta })),
    },
  },
});
