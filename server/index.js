/**
 * Proxy tối thiểu cho Gemini API.
 *
 * Lý do tồn tại: API key KHÔNG được xuống trình duyệt. Bất kỳ ai mở devtools
 * cũng đọc được, và key sẽ bị quét mất nếu deploy. Xem decision 0002.
 *
 * Server này chỉ làm hai việc: giữ key, và chuyển câu nói + ngữ cảnh phiên
 * thành một intent có cấu trúc. Nó không giữ state và không tính điểm.
 */

import express from "express";
import "dotenv/config";

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * Các intent MVP hỗ trợ — xem docs/product/conversation.md.
 *
 * LLM chỉ suy ra ý định và tham số. Nó KHÔNG ghi điểm: code phía client mới
 * quyết định có hỏi xác nhận không rồi mới gọi tool. Giữ ranh giới này để sau
 * tách thành LLM Planner + Tool Dispatcher mà không đổi hợp đồng (decision 0001).
 */
const FUNCTION_DECLARATIONS = [
  {
    name: "record_round",
    description:
      "Ghi điểm cho một ván vừa xong. Chỉ dùng khi người nói đã cho biết đủ ai được bao nhiêu điểm.",
    parameters: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description:
            "Điểm của từng người trong ván này. Người thắng có delta dương, người chung/thua có delta âm.",
          items: {
            type: "object",
            properties: {
              player_id: { type: "string", description: "id của người chơi" },
              delta: {
                type: "integer",
                description: "Điểm cộng (dương) hoặc trừ (âm) của người này",
              },
            },
            required: ["player_id", "delta"],
          },
        },
      },
      required: ["entries"],
    },
  },
  {
    name: "query_scoreboard",
    description:
      "Người dùng hỏi bảng điểm chung hoặc ai đang dẫn đầu.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "query_player",
    description: "Người dùng hỏi điểm của một người cụ thể.",
    parameters: {
      type: "object",
      properties: {
        player_id: {
          type: "string",
          description:
            "id người được hỏi. Nếu người nói dùng 'tôi/tao/mình' thì lấy id của người đang cầm máy.",
        },
      },
      required: ["player_id"],
    },
  },
  {
    name: "undo_round",
    description:
      "Người dùng muốn hủy một ván đã ghi, ví dụ 'nhầm rồi', 'hủy ván vừa nãy'.",
    parameters: {
      type: "object",
      properties: {
        sequence_no: {
          type: "integer",
          description:
            "Số thứ tự ván cần hủy. Bỏ trống nếu người dùng muốn hủy ván gần nhất.",
        },
      },
    },
  },
  {
    name: "query_history",
    description: "Người dùng hỏi về các ván trước đó.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "Số ván gần nhất cần xem" },
      },
    },
  },
  {
    name: "add_player",
    description: "Người dùng muốn thêm một người chơi mới vào phiên.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Tên người chơi mới" },
      },
      required: ["name"],
    },
  },
  {
    name: "end_session",
    description: "Người dùng muốn kết thúc phiên chơi và chốt tổng.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "clarify",
    description:
      "Dùng khi KHÔNG đủ thông tin để hành động: thiếu người, thiếu số điểm, tên lạ, tổng điểm không khớp, hoặc câu nói mơ hồ. Đây là lựa chọn đúng khi còn nghi ngờ — thà hỏi lại còn hơn ghi sai điểm.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Đúng MỘT câu hỏi ngắn bằng tiếng Việt để làm rõ. Không hỏi dồn nhiều thứ.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "unsupported",
    description:
      "Câu nói nằm ngoài những việc app làm được (ghi điểm, tra cứu, hủy ván, thêm người, kết thúc).",
    parameters: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "Câu trả lời ngắn bằng tiếng Việt nói rõ app không làm được việc này.",
        },
      },
      required: ["reply"],
    },
  },
];

function buildSystemPrompt(context) {
  const { players, scoreboard, mePlayerId, zeroSum, roundsPlayed } = context;

  const roster = players
    .map((p) => {
      const row = scoreboard.find((r) => r.playerId === p.id);
      const me = p.id === mePlayerId ? " (người đang cầm máy — 'tôi/mình')" : "";
      return `- ${p.name}${me}: id=${p.id}, đang có ${row ? row.total : 0} điểm`;
    })
    .join("\n");

  return `Bạn là trợ lý ghi điểm cho một nhóm chơi bài. Bạn nghe một câu tiếng Việt đã được chuyển từ giọng nói sang chữ, rồi suy ra người nói muốn làm gì.

Người chơi trong phiên (đã chơi ${roundsPlayed} ván):
${roster}

Quy tắc hiểu tiếng Việt:
- "ăn", "thắng", "được" = điểm dương. "chung", "thua", "đền", "mất" = điểm âm.
- "tôi", "tao", "mình", "tớ" = người đang cầm máy.
- "ba người kia", "mấy người còn lại", "cả làng" = tất cả những người chơi không được nhắc tên.
- Tên nghe được có thể sai chính tả do nhận dạng giọng nói. Nếu gần đúng một tên trong danh sách thì cứ khớp vào (ví dụ "Hùn" → "Hùng"). Nếu không giống ai thì gọi clarify.
${
  zeroSum
    ? `
QUAN TRỌNG — tổng điểm mỗi ván phải bằng 0:
Điểm chỉ chuyển giữa những người chơi, không sinh ra thêm. Trước khi gọi record_round, hãy cộng tất cả delta lại và kiểm tra bằng 0.
- Nếu người nói chỉ cho biết người thắng và số điểm (ví dụ "Nam ăn 6"), ĐỪNG tự bịa cách chia. Gọi clarify và đề xuất chia đều: "6 điểm này ai chung? Chia đều 3 người còn lại nhé?"
- Nếu người nói đã nói rõ cách chia và tổng vẫn khác 0, gọi clarify và đọc lại con số bạn nghe được.
- Chỉ gọi record_round khi tổng đúng bằng 0.`
    : ""
}
Nguyên tắc: nghe nhầm điểm làm mất vui cả ván. Khi còn nghi ngờ, luôn chọn clarify thay vì đoán.

Luôn gọi đúng một function. Mọi câu chữ bạn viết ra phải bằng tiếng Việt, ngắn gọn, tự nhiên như đang nói.`;
}

app.post("/api/interpret", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      error:
        "Thiếu GEMINI_API_KEY. Copy .env.example thành .env và điền key lấy từ https://aistudio.google.com/apikey",
    });
  }

  const { transcript, context } = req.body ?? {};
  if (typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "Thiếu transcript." });
  }
  if (!context || !Array.isArray(context.players)) {
    return res.status(400).json({ error: "Thiếu ngữ cảnh phiên chơi." });
  }

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
    contents: [
      ...(context.pendingQuestion
        ? [
            {
              role: "model",
              parts: [{ text: context.pendingQuestion }],
            },
          ]
        : []),
      { role: "user", parts: [{ text: transcript }] },
    ],
    tools: [{ function_declarations: FUNCTION_DECLARATIONS }],
    tool_config: { function_calling_config: { mode: "ANY" } },
    generationConfig: { temperature: 0 },
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": API_KEY,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error(`Gemini ${response.status}:`, detail);
      // Quota là lỗi hay gặp nhất ở free tier — nói rõ để khỏi phải đoán.
      const message =
        response.status === 429
          ? "Hết quota Gemini hôm nay (free tier 1000 lượt/ngày). Thử lại sau hoặc nhập điểm bằng tay."
          : `Gemini trả lỗi ${response.status}.`;
      return res.status(502).json({ error: message });
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const call = parts.find((p) => p.functionCall)?.functionCall;

    if (!call) {
      const text = parts.find((p) => p.text)?.text;
      return res.json({
        intent: "clarify",
        args: { question: text || "Mình chưa nghe rõ, nói lại giúp nhé." },
      });
    }

    return res.json({ intent: call.name, args: call.args ?? {} });
  } catch (error) {
    console.error("interpret failed:", error);
    return res
      .status(502)
      .json({ error: "Không gọi được Gemini. Kiểm tra kết nối mạng." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(API_KEY) });
});

app.listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT}  model=${MODEL}`);
  if (!API_KEY) {
    console.warn(
      "[api] CHƯA CÓ GEMINI_API_KEY — copy .env.example thành .env rồi điền key.",
    );
  }
});
