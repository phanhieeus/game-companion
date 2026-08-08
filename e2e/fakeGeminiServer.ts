/**
 * Gemini giả cho e2e — chạy như một tiến trình riêng, xem playwright.config.ts.
 *
 * Từ ADR 13, mọi thứ thật sự nằm ở server: tool layer, vòng ReAct, dữ liệu ván.
 * Mock ở tầng trình duyệt (`page.route("/api/...")`) sẽ chặn mất chính cái cần
 * kiểm. Nên thay vì giả API của mình, ta giả ĐÚNG MỘT THỨ không kiểm soát được:
 * Gemini. Toàn bộ phần còn lại — HTTP, validate, nhật ký, chốt HITL, lưu đĩa —
 * là code thật đang chạy.
 *
 * Test đặt kịch bản qua `POST /__script`, khoá theo câu người dùng nói, nên thứ
 * tự chạy không ảnh hưởng lẫn nhau.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_GEMINI_PORT) || 8799;

interface Reply {
  text?: string;
  call?: { name: string; args?: Record<string, unknown> };
}

/** câu người dùng nói → các lượt trả lời liên tiếp cho câu đó */
let script: Record<string, Reply[]> = {};
const used: Record<string, number> = {};

/** Số lỗi cần trả trước khi bắt đầu chạy kịch bản — để test đường thử lại. */
let failuresLeft = 0;

const readBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

/** Câu người dùng nói gần nhất trong `contents` gửi lên. */
function lastUserText(body: {
  contents?: { role?: string; parts?: { text?: string }[] }[];
}): string {
  const users = (body.contents ?? []).filter(
    (c) => c.role === "user" && c.parts?.some((p) => typeof p.text === "string"),
  );
  return users.at(-1)?.parts?.find((p) => p.text)?.text ?? "";
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "";

  // Playwright thăm dò bằng GET để biết server đã lên chưa.
  if (req.method === "GET" && url.startsWith("/__script")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (req.method === "POST" && url.startsWith("/__script")) {
    const body = (await readBody(req)) as {
      script?: Record<string, Reply[]>;
      failures?: number;
    };
    script = body.script ?? {};
    failuresLeft = body.failures ?? 0;
    for (const key of Object.keys(used)) delete used[key];
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (req.method === "POST" && url.includes(":generateContent")) {
    const body = await readBody(req);

    if (failuresLeft > 0) {
      failuresLeft -= 1;
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "giả vờ hỏng" } }));
    }

    const text = lastUserText(body);
    const replies = script[text] ?? [{ text: "Chưa có kịch bản cho câu này." }];
    const step = used[text] ?? 0;
    used[text] = step + 1;
    const reply = replies[step] ?? replies.at(-1) ?? { text: "Xong." };

    const parts = reply.call
      ? [
          {
            functionCall: { name: reply.call.name, args: reply.call.args ?? {} },
            // Gemini thật gắn chữ ký này; giả luôn để đi đúng đường code.
            thoughtSignature: "fake-signature",
          },
        ]
      : [{ text: reply.text ?? "Xong." }];

    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ candidates: [{ content: { parts } }] }));
  }

  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`[fake-gemini] http://localhost:${PORT}`);
});
