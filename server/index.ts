/**
 * Backend của app ghi điểm (ADR 13).
 *
 * Server sở hữu miền nghiệp vụ: dữ liệu phiên, tool layer, và cả vòng ReAct của
 * agent. Frontend chỉ trình bày và thu thao tác. Nhờ vậy tool chạy cùng chỗ với
 * dữ liệu, và API key không bao giờ xuống trình duyệt (decision 0002).
 *
 * Chạy `.ts` thẳng bằng Node (type stripping) — không có bước build cho server,
 * đổi lại import phải ghi rõ đuôi `.ts`.
 */

import express from "express";
import type { NextFunction, Request, Response } from "express";
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { createTools } from "./tools/index.ts";
import { FileSessionRepository } from "./repository/fileRepository.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { agentRoutes } from "./routes/agent.ts";
import type { FactStore } from "./agent/memory.ts";
import type { MemoryFact } from "./agent/types.ts";
import { hasApiKey, modelName } from "./gemini.ts";

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");

const repo = new FileSessionRepository(join(DATA_DIR, "sessions.json"));
const tools = createTools(repo);

/** Nhớ lâu của agent — cùng chính sách "hỏng thì rỗng" như kho phiên. */
const factStore: FactStore = {
  read() {
    try {
      const parsed = JSON.parse(
        readFileSync(join(DATA_DIR, "memory.json"), "utf8"),
      ) as MemoryFact[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  write(facts) {
    const path = join(DATA_DIR, "memory.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(facts, null, 2), "utf8");
  },
};

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api/sessions", sessionRoutes(tools, repo));
app.use("/api/sessions", agentRoutes(tools, repo, factStore));

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, model: modelName(), hasKey: hasApiKey() });
});

/**
 * Xoá sạch dữ liệu — CHỈ tồn tại khi bật `E2E_RESET`.
 *
 * Mỗi test e2e phải bắt đầu từ con số không, mà dữ liệu giờ nằm ở server nên
 * xoá localStorage không còn tác dụng gì. Đặt sau cờ môi trường để route này
 * đơn giản là KHÔNG TỒN TẠI khi chạy thật — không phải "có nhưng chặn".
 */
if (process.env.E2E_RESET === "1") {
  app.post("/api/test/reset", (_req: Request, res: Response) => {
    for (const session of repo.list()) repo.delete(session.id);
    res.json({ ok: true });
  });
  console.warn("[api] E2E_RESET đang BẬT — có route xoá sạch dữ liệu.");
}

/**
 * Lỗi ngoài dự tính → 500 + `retryable: true`.
 *
 * Lỗi luật chơi đã ra 400 ở tầng route (xem `routes/sessions.ts`), nên tới đây
 * chỉ còn thứ thật sự hỏng — và thứ đó thì thử lại có khi được.
 */
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("unhandled:", error);
  res.status(500).json({
    error: { code: "INTERNAL", message: "Máy chủ trục trặc." },
    retryable: true,
  });
});

app.listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT}  model=${modelName()}`);
  console.log(`[api] dữ liệu: ${DATA_DIR}`);
  if (!hasApiKey()) {
    console.warn("[api] CHƯA có GEMINI_API_KEY — giọng nói sẽ không dùng được.");
  }
});
